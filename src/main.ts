import Phaser from 'phaser';
import { Sfx } from './client/audio';
import { Controller } from './client/controller';
import { attachInput } from './client/input';
import { RENDER_SCALE, RunScene } from './client/scene';
import { loadBest, loadOverrides, loadSave, storeBest } from './client/storage';
import { Ui } from './client/ui';

const frame = document.getElementById('frame')!;
const uiRoot = document.getElementById('ui')!;

const sfx = new Sfx();
const controller = new Controller(loadOverrides());

const ui = new Ui(uiRoot, controller, sfx, {
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
  if (phase === 'dead') {
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
(window as unknown as Record<string, unknown>).__relay = { controller, game, ui };
