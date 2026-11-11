import Phaser from 'phaser';
import type { ClaimGrant } from './relay/types';
import { api, relayEnabled, runIdFromUrl, type ApiResult } from './client/api';
import { Sfx } from './client/audio';
import { botInput } from './sim';
import { Controller } from './client/controller';
import { attachInput } from './client/input';
import { RENDER_SCALE, RunScene } from './client/scene';
import { loadBest, loadOverrides, loadSave, storeBest } from './client/storage';
import { strings } from './client/strings';
import { Ui } from './client/ui';

const frame = document.getElementById('frame')!;
const uiRoot = document.getElementById('ui')!;

const sfx = new Sfx();
const controller = new Controller(loadOverrides());

let linkedRun = relayEnabled ? runIdFromUrl() : null;

/** Ask the relay for a run and start playing it. */
async function beginRelay(request: () => Promise<ApiResult<ClaimGrant>>): Promise<void> {
  sfx.unlock();
  ui.showBusy(strings.finding);
  const grant = await request();
  if (linkedRun) {
    // The link has done its job. Drop it so a refresh does not try to claim the same run again.
    linkedRun = null;
    history.replaceState(null, '', location.pathname);
  }
  if (!grant.ok) return ui.showError(grant.error);
  sfx.play('start');
  ui.hideOverlay();
  ui.setHudVisible(true);
  controller.startFromGrant(grant.state, {
    runId: grant.runId,
    claimToken: grant.claimToken,
    segmentIndex: grant.segmentIndex,
  });
}

/** Send the finished leg to the relay, then show the timeline of the run. */
async function finishRelaySegment(): Promise<void> {
  const relay = controller.relay;
  const result = controller.segmentResult();
  if (!relay || !result) return;
  let outcome = await api.submit(relay.runId, relay.claimToken, result.log, result.hash);
  for (let retry = 0; retry < 3 && !outcome.ok && outcome.error === 'offline'; retry++) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    outcome = await api.submit(relay.runId, relay.claimToken, result.log, result.hash);
  }
  // While offline the save is kept, so "Continue" can retry the submit later.
  if (!outcome.ok && outcome.error === 'offline') return ui.showError('offline');
  controller.clear();
  if (!outcome.ok) return ui.showError(outcome.error);
  const timeline = await api.timeline(relay.runId);
  if (!timeline.ok) return ui.showError(timeline.error);
  ui.showTimeline(timeline, relay.runId);
}

const ui = new Ui(uiRoot, controller, sfx, {
  relay: relayEnabled,
  linkedRun: () => linkedRun,
  carryRun: () => void beginRelay(() => api.claimNext()),
  takeRun: (runId) => void beginRelay(() => api.claim(runId)),
  startRelayRun: () => void beginRelay(() => api.start()),
  startRun: () => {
    sfx.unlock();
    sfx.play('start');
    ui.hideOverlay();
    ui.setHudVisible(true);
    // The seed only needs to differ between runs. From Phase 2 the server issues it.
    controller.newRun((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
  },
  continueRun: () => {
    const save = loadSave();
    if (!save) return ui.showTitle();
    sfx.unlock();
    ui.setHudVisible(true);
    controller.resume(save);
  },
});

const scene = new RunScene(controller, sfx, () => ui.update(controller.state));

controller.onEvents = (events) => scene.handleEvents(events);
controller.onPhase = (phase) => {
  const state = controller.state;
  if (!state) return;
  if (controller.relay && (phase === 'dead' || phase === 'handoff')) {
    ui.showForPhase(state);
    // On death, let the burst play out before the timeline covers it.
    window.setTimeout(() => void finishRelaySegment(), phase === 'dead' ? 900 : 0);
  } else if (phase === 'dead') {
    const best = loadBest();
    const newBest = state.floor > best;
    if (newBest) storeBest(state.floor);
    // Let the death burst play out before covering it.
    window.setTimeout(() => {
      if (controller.state === state) ui.showDead(state, newBest && best > 0);
    }, 700);
  } else {
    ui.showForPhase(state);
  }
};

const { width, height } = controller.cfg.tuning.arena;
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: width * RENDER_SCALE,
  height: height * RENDER_SCALE,
  backgroundColor: '#0d0b14',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, powerPreference: 'high-performance' },
  audio: { noAudio: true },
  banner: false,
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  scene: [scene],
});

attachInput(controller, frame);
ui.showTitle();

// Pause and save whenever the page is hidden, so a phone call or app switch never costs a run.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  controller.save();
  if (!controller.paused && controller.phase() === 'play') {
    controller.paused = true;
    ui.showPaused();
  }
});
window.addEventListener('pagehide', () => controller.save());

if (new URLSearchParams(location.search).has('tune')) ui.showTuning();

// Handy for debugging and for the end-to-end tests.
(window as unknown as Record<string, unknown>).__relay = {
  controller,
  game,
  ui,
  /** Let the bot play the rest of the current leg instantly. The relay rejects legs played this fast. */
  botPlay: () => {
    while (controller.state && !controller.paused && controller.phase() === 'play') {
      const input = botInput(controller.state, controller.cfg);
      controller.setInput(input.mx, input.my);
      controller.advance(controller.tickMs + 0.01);
    }
    return controller.phase();
  },
};
