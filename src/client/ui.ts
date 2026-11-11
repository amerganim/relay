import { defaultConfig, segmentTicks, type RunState } from '../sim';
import type { Sfx } from './audio';
import type { Controller } from './controller';
import { getPath, loadBest, loadSave, storeOverrides, type Overrides } from './storage';
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
  startRun: () => void;
  continueRun: () => void;
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
  private muteButton = el('button', 'hud-mute');
  private overlay = el('div', 'overlay');
  private cache: Record<string, string> = {};
  private lastSecond = -1;
  private floorTaps: number[] = [];

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
    );
    this.root.append(this.hud, this.overlay);

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

    const urgent = seconds <= 5 && state.phase === 'play';
    this.timerLabel.classList.toggle('urgent', urgent);
    this.goalLabel.classList.toggle('open', !!state.exit);
    if (urgent && seconds !== this.lastSecond && seconds > 0) this.sfx.play('tick');
    this.lastSecond = seconds;
  }

  setHudVisible(visible: boolean): void {
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
    this.show(
      'title',
      el('div', 'flame'),
      el('h1', 'logo', strings.title),
      el('p', 'tagline', strings.tagline),
      save &&
        this.button(strings.continue(save.state.floor, save.state.segment + 1), () => this.actions.continueRun(), 'btn primary'),
      this.button(strings.play, () => this.actions.startRun(), save ? 'btn' : 'btn primary'),
      el('p', 'hint', strings.howTo),
      best > 0 && el('p', 'best', strings.best(best)),
    );
  }

  showUpgrade(state: RunState): void {
    const cards = state.offers.map((id, i) => {
      const def = this.controller.cfg.upgrades.find((u) => u.id === id);
      const card = el('button', 'card', el('span', 'card-name', def?.name ?? id), el('span', 'card-desc', def?.desc ?? ''));
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
    else if (state.phase === 'handoff') this.showHandoff(state);
    else this.hideOverlay();
  }
}
