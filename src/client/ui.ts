import type { Timeline } from '../relay/types';
import settings from '../relay/data/relay.json';
import { defaultConfig, enemyDef, isBossFloor, segmentTicks, type RunState } from '../sim';
import { api, shareUrl } from './api';
import type { Sfx } from './audio';
import type { Controller } from './controller';
import {
  finishTutorial,
  getPath,
  loadBest,
  loadDailyBest,
  loadSave,
  storeOverrides,
  tutorialDone,
  type Overrides,
} from './storage';
import { strings } from './strings';

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Values the hidden tuning panel can change: [config path, label, min, max, step]. */
const TUNING_FIELDS: [string, string, number, number, number][] = [
  ['tuning.player.moveSpeed', 'Player speed', 80, 320, 5],
  ['tuning.player.damage', 'Player damage', 2, 40, 1],
  ['tuning.player.fireCooldown', 'Seconds between shots', 0.1, 1, 0.02],
  ['tuning.player.maxHp', 'Player health', 20, 300, 5],
  ['tuning.floor.spawnInterval', 'Seconds between spawns', 0.2, 2.5, 0.05],
  ['tuning.floor.baseQuota', 'Enemies on floor 1', 2, 20, 1],
  ['tuning.floor.quotaPerFloor', 'Extra enemies per floor', 0, 6, 1],
  ['tuning.floor.hpScalePerFloor', 'Enemy health growth per floor', 0, 0.5, 0.01],
  ['tuning.floor.damageScalePerFloor', 'Enemy damage growth per floor', 0, 0.3, 0.01],
  ['enemies.0.speed', 'Grunt speed', 20, 160, 2],
  ['enemies.1.dashSpeed', 'Dasher charge speed', 150, 600, 10],
  ['enemies.2.shotSpeed', 'Spitter shot speed', 60, 320, 5],
  ['tuning.segmentSeconds', 'Seconds per leg', 15, 120, 5],
];

export interface UiActions {
  /** Start a solo run on this device. */
  startRun: () => void;
  /** Start today's Daily run: the same seed for everyone. */
  startDaily: () => void;
  continueRun: () => void;
  /** True when a relay backend is configured. */
  relay: boolean;
  /** The run id from a share link, if the page was opened through one. */
  linkedRun: () => string | null;
  carryRun: () => void;
  takeRun: (runId: string) => void;
  startRelayRun: () => void;
}

export class Ui {
  private hud = el('div', 'hud');
  private floorLabel = el('button', 'hud-floor');
  private legLabel = el('div', 'hud-leg');
  private timerLabel = el('div', 'hud-timer');
  private goalLabel = el('div', 'hud-goal');
  private timeFill = el('div', 'bar-fill time');
  private hpFill = el('div', 'bar-fill hp');
  private hpLabel = el('div', 'hud-hp-label');
  private bossFill = el('div', 'bar-fill boss');
  private bossLabel = el('div', 'boss-name');
  private bossBar = el('div', 'boss-bar', this.bossLabel, el('div', 'bar boss-track', this.bossFill));
  private muteButton = el('button', 'hud-mute');
  private overlay = el('div', 'overlay');
  private cache: Record<string, string> = {};
  private lastSecond = -1;
  private floorTaps: number[] = [];
  private hint = el('div', 'hint-banner');
  /** First-run coaching: 0 move, 1 fight, 2 take the stairs, 3 finished. */
  private hintStep = tutorialDone() ? 3 : 0;
  private hintStart: { x: number; y: number } | null = null;

  constructor(
    private root: HTMLElement,
    private controller: Controller,
    private sfx: Sfx,
    private actions: UiActions,
  ) {
    const top = el(
      'div',
      'hud-top',
      el('div', 'hud-left', this.floorLabel, this.legLabel),
      this.timerLabel,
      el('div', 'hud-right', this.goalLabel, this.muteButton),
    );
    this.hud.append(
      el('div', 'bar', this.timeFill),
      top,
      el('div', 'bar hp-bar', this.hpFill, this.hpLabel),
      this.bossBar,
    );
    this.root.append(this.hud, this.hint, this.overlay);

    this.muteButton.addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.setMuted(!this.sfx.muted);
      this.renderMute();
    });
    this.renderMute();

    // Hidden entrance to the tuning panel: tap the floor label five times quickly.
    this.floorLabel.addEventListener('click', () => {
      const now = performance.now();
      this.floorTaps = this.floorTaps.filter((t) => now - t < 2000);
      this.floorTaps.push(now);
      if (this.floorTaps.length >= 5) {
        this.floorTaps = [];
        this.showTuning();
      }
    });
  }

  private renderMute(): void {
    this.muteButton.textContent = this.sfx.muted ? '🔇' : '🔊';
    this.muteButton.setAttribute('aria-label', this.sfx.muted ? strings.soundOff : strings.soundOn);
  }

  private set(key: string, node: HTMLElement, text: string): void {
    if (this.cache[key] === text) return;
    this.cache[key] = text;
    node.textContent = text;
  }

  /** Called every frame. Only touches the DOM when a value has changed. */
  update(state: RunState | null): void {
    if (!state) return;
    const cfg = this.controller.cfg;
    const total = segmentTicks(cfg);
    const left = Math.max(0, total - state.segTick);
    const seconds = Math.ceil(left / cfg.tuning.tickRate);

    this.set('floor', this.floorLabel, strings.floor(state.floor));
    const boss = isBossFloor(state.floor, cfg) ? state.enemies.find((e) => enemyDef(cfg, e.type).boss) : undefined;
    this.set('boss', this.bossLabel, boss ? enemyDef(cfg, boss.type).name : '');
    this.bossBar.classList.toggle('on', !!boss);
    if (boss) this.bossFill.style.width = `${((boss.hp / boss.maxHp) * 100).toFixed(1)}%`;
    this.set('leg', this.legLabel, strings.leg(state.segment + 1));
    this.set('timer', this.timerLabel, String(seconds));
    this.set('goal', this.goalLabel, state.exit ? strings.stairsOpen : `${state.floorKills}/${state.floorQuota}`);
    this.set('hp', this.hpLabel, `${Math.ceil(state.player.hp)}`);

    const timeWidth = `${((left / total) * 100).toFixed(1)}%`;
    if (this.cache.timeWidth !== timeWidth) {
      this.cache.timeWidth = timeWidth;
      this.timeFill.style.width = timeWidth;
    }
    const hpWidth = `${((state.player.hp / state.player.stats.maxHp) * 100).toFixed(1)}%`;
    if (this.cache.hpWidth !== hpWidth) {
      this.cache.hpWidth = hpWidth;
      this.hpFill.style.width = hpWidth;
    }

    this.updateHints(state);
    const urgent = seconds <= 5 && state.phase === 'play';
    this.timerLabel.classList.toggle('urgent', urgent);
    this.goalLabel.classList.toggle('open', !!state.exit);
    if (urgent && seconds !== this.lastSecond && seconds > 0) this.sfx.play('tick');
    this.lastSecond = seconds;
  }

  /** A three-step tutorial that plays out inside the first run and takes well under 30 seconds. */
  private updateHints(state: RunState): void {
    if (this.hintStep >= 3) return;
    const p = state.player;
    this.hintStart ??= { x: p.x, y: p.y };
    if (state.floor > 1) {
      this.hintStep = 3;
      finishTutorial();
    } else if (this.hintStep === 0) {
      const dx = p.x - this.hintStart.x;
      const dy = p.y - this.hintStart.y;
      if (dx * dx + dy * dy > 50 * 50) this.hintStep = 1;
    } else if (this.hintStep === 1 && state.exit) {
      this.hintStep = 2;
    }
    const text = state.phase === 'play' && this.hintStep < 3 ? strings.hints[this.hintStep] : '';
    this.set('hint', this.hint, text);
    this.hint.classList.toggle('on', text !== '');
  }

  setHudVisible(visible: boolean): void {
    if (!visible) this.hint.classList.remove('on');
    this.hud.classList.toggle('on', visible);
  }

  hideOverlay(): void {
    this.overlay.className = 'overlay';
    this.overlay.replaceChildren();
  }

  private show(kind: string, ...children: Child[]): void {
    this.overlay.className = `overlay on ${kind}`;
    this.overlay.replaceChildren(el('div', 'panel', ...children));
  }

  private button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
    const b = el('button', className, label);
    b.addEventListener('click', () => {
      this.sfx.unlock();
      onClick();
    });
    return b;
  }

  showTitle(): void {
    const save = loadSave();
    const best = loadBest();
    this.setHudVisible(false);
    const linked = this.actions.linkedRun();
    const main = save ? 'btn' : 'btn primary';
    const entry = this.actions.relay
      ? [
          linked
            ? this.button(strings.takeTorch, () => this.actions.takeRun(linked), main)
            : this.button(strings.carryRun, () => this.actions.carryRun(), main),
          this.button(strings.startNewRun, () => this.actions.startRelayRun()),
          this.button(strings.playSolo, () => this.actions.startRun()),
        ]
      : [this.button(strings.play, () => this.actions.startRun(), main)];
    const dailyBest = loadDailyBest();
    entry.push(this.button(strings.daily, () => this.actions.startDaily()));
    this.show(
      'title',
      el('div', 'flame'),
      el('h1', 'logo', strings.title),
      el('p', 'tagline', strings.tagline),
      save &&
        this.button(strings.continue(save.state.floor, save.state.segment + 1), () => this.actions.continueRun(), 'btn primary'),
      ...entry,
      el('p', 'hint', strings.howTo),
      el('p', 'best', dailyBest > 0 ? strings.dailyBest(dailyBest) : strings.dailyNote),
      best > 0 && el('p', 'best', strings.best(best)),
    );
  }

  showUpgrade(state: RunState): void {
    const cards = state.offers.map((id, i) => {
      const def = this.controller.cfg.upgrades.find((u) => u.id === id);
      const risky = def?.kind === 'risky';
      const card = el(
        'button',
        risky ? 'card risky' : 'card',
        el('span', 'card-name', def?.name ?? id),
        el('span', 'card-desc', def?.desc ?? ''),
        risky && el('span', 'card-tag', strings.risky),
      );
      card.addEventListener('click', () => {
        this.sfx.unlock();
        this.sfx.play('pick');
        this.controller.choose(i);
      });
      return card;
    });
    this.show(
      'upgrade',
      el('h2', '', strings.timeUp),
      el('p', 'sub', strings.chooseUpgrade),
      el('div', 'cards', ...cards),
    );
    // Guard against a thumb that was still dragging when the timer ran out.
    this.overlay.classList.add('locked');
    window.setTimeout(() => this.overlay.classList.remove('locked'), 450);
  }

  showHandoff(state: RunState): void {
    this.show(
      'handoff',
      el('div', 'flame small'),
      el('h2', '', strings.handoffTitle(state.segment + 1)),
      el('p', 'sub', strings.handoffBody(state.floor)),
      this.button(strings.nextLeg, () => {
        this.sfx.play('start');
        this.controller.nextSegment();
      }, 'btn primary'),
    );
  }

  showDead(state: RunState, newBest: boolean): void {
    const counts = new Map<string, number>();
    for (const id of state.upgrades) counts.set(id, (counts.get(id) ?? 0) + 1);
    const chips = [...counts].map(([id, n]) => {
      const name = this.controller.cfg.upgrades.find((u) => u.id === id)?.name ?? id;
      return el('span', 'chip', n > 1 ? `${name} ×${n}` : name);
    });
    this.show(
      'dead',
      el('h2', '', strings.deadTitle),
      el('p', 'big', strings.floor(state.floor)),
      newBest && el('p', 'new-best', strings.newBest),
      el('p', 'sub', strings.deadStats(state.floor, state.segment + 1, state.kills)),
      el('p', 'label', strings.upgradesTaken),
      el('div', 'chips', ...(chips.length ? chips : [el('span', 'chip', strings.none)])),
      this.button(strings.playAgain, () => this.actions.startRun(), 'btn primary'),
    );
    this.overlay.classList.add('locked');
    window.setTimeout(() => this.overlay.classList.remove('locked'), 600);
  }

  /** A waiting screen while talking to the relay. */
  showBusy(text: string): void {
    this.show('busy', el('div', 'flame small'), el('p', 'sub', text));
  }

  showError(code: string): void {
    this.setHudVisible(false);
    this.show(
      'error',
      el('h2', '', strings.errors[code] ?? strings.errors.offline),
      this.button(strings.back, () => this.showTitle(), 'btn primary'),
    );
  }

  /** Who carried the run and how far each got, with the share link and the emote picker. */
  showTimeline(timeline: Timeline, runId: string): void {
    this.setHudVisible(false);
    const dead = timeline.run.status === 'dead';
    const upgradeName = (id: string | null) =>
      id ? (this.controller.cfg.upgrades.find((u) => u.id === id)?.name ?? id) : '';

    const rows = timeline.segments.map((s) =>
      el(
        'div',
        s.mine ? 'leg mine' : 'leg',
        el('span', 'leg-n', String(s.index + 1)),
        el('span', 'leg-who', s.mine ? strings.you : s.isBot ? strings.bot : strings.carrier(s.carrier)),
        el('span', 'leg-floors', strings.floors(s.floorStart, s.floorEnd)),
        el('span', 'leg-note', s.died ? strings.fell : upgradeName(s.upgrade), s.emotes.length ? ` ${s.emotes.join('')}` : ''),
      ),
    );

    const mine = [...timeline.segments].reverse().find((s) => s.mine);
    const emoteRow =
      mine && mine.emotes.length === 0
        ? el(
            'div',
            'emotes',
            ...settings.emotes.map((emote) => {
              const b = el('button', 'emote', emote);
              b.setAttribute('aria-label', `${strings.leaveEmote} ${emote}`);
              b.addEventListener('click', async () => {
                emoteRow?.classList.add('sent');
                const res = await api.emote(runId, mine.index, emote);
                if (res.ok) {
                  const again = await api.timeline(runId);
                  if (again.ok) this.showTimeline(again, runId);
                }
              });
              return b;
            }),
          )
        : null;

    const share = this.button(strings.share, async () => {
      const url = shareUrl(runId);
      try {
        if (navigator.share) await navigator.share({ title: strings.title, text: strings.tagline, url });
        else {
          await navigator.clipboard.writeText(url);
          share.textContent = strings.copied;
        }
      } catch {
        // The share sheet was closed. Nothing to do.
      }
    });

    this.show(
      'timeline',
      el('h2', '', dead ? strings.deadTitle : strings.passedTitle),
      el('p', 'big', strings.floor(timeline.run.floor)),
      !dead && el('p', 'sub', strings.passedBody),
      el('div', 'legs', ...rows),
      emoteRow && el('p', 'label', strings.leaveEmote),
      emoteRow,
      !dead && share,
      this.button(strings.carryAnother, () => this.actions.carryRun(), 'btn primary'),
      this.button(strings.back, () => this.showTitle()),
    );
  }

  showPaused(): void {
    this.show(
      'paused',
      el('h2', '', strings.paused),
      this.button(strings.resume, () => {
        this.hideOverlay();
        this.controller.paused = false;
      }, 'btn primary'),
    );
  }

  showTuning(): void {
    const wasPaused = this.controller.paused;
    this.controller.paused = true;
    const draft: Overrides = { ...this.controller.overrides };

    const rows = TUNING_FIELDS.map(([path, label, min, max, step]) => {
      const current = draft[path] ?? getPath(defaultConfig, path);
      const value = el('span', 'tune-value', String(current));
      const slider = el('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.value = String(current);
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        value.textContent = String(v);
        if (v === getPath(defaultConfig, path)) delete draft[path];
        else draft[path] = v;
      });
      return el('label', 'tune-row', el('span', 'tune-label', label), slider, value);
    });

    const apply = (overrides: Overrides) => {
      storeOverrides(overrides);
      this.controller.setOverrides(overrides);
      this.actions.startRun();
    };
    const copy = this.button(strings.tuningCopy, () => {
      void navigator.clipboard?.writeText(JSON.stringify(draft, null, 2));
      copy.textContent = strings.tuningCopied;
    });

    this.show(
      'tuning',
      el('h2', '', strings.tuning),
      el('div', 'tune-list', ...rows),
      this.button(strings.tuningApply, () => apply(draft), 'btn primary'),
      this.button(strings.tuningReset, () => apply({})),
      copy,
      this.button(strings.close, () => {
        const state = this.controller.state;
        if (!state) return this.showTitle();
        if (state.phase !== 'play') return this.showForPhase(state);
        this.hideOverlay();
        this.controller.paused = wasPaused;
      }),
    );
  }

  /** Show whichever overlay matches the run's current phase. */
  showForPhase(state: RunState): void {
    if (state.phase === 'upgrade') this.showUpgrade(state);
    else if (state.phase === 'handoff' && !this.controller.relay) this.showHandoff(state);
    else if (state.phase === 'handoff') this.showBusy(strings.passing);
    else this.hideOverlay();
  }
}
