import Phaser from 'phaser';
import { enemyDef, type RunState, type SimEvent } from '../sim';
import { vibrate, type Sfx } from './audio';
import type { Controller } from './controller';

/** Canvas pixels per simulation unit. The arena is 360x640 units, drawn at 720x1280. */
export const RENDER_SCALE = 2;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: number;
  r: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: number;
}

const COLORS = {
  player: 0xffb347,
  playerCore: 0xfff1b8,
  shot: 0xffe08a,
  spit: 0xff4d6d,
  heart: 0xff7aa8,
  exit: 0x7ad7ff,
  pillar: 0x35304a,
  pillarTop: 0x4b4568,
  enemy: { grunt: 0xd9534f, dasher: 0xb072f0, spitter: 0x5fbf6a } as Record<string, number>,
};

/** Floor tile colors, cycling every few floors so climbing looks like progress. */
const PALETTES = [
  [0x17142a, 0x1b1830, 0x2a2546],
  [0x14202a, 0x172631, 0x24404c],
  [0x231a1a, 0x2a1f1f, 0x4a2f2a],
  [0x1a2318, 0x1f2a1c, 0x33492c],
  [0x231829, 0x2a1c31, 0x48294f],
];

export class RunScene extends Phaser.Scene {
  private bg!: Phaser.GameObjects.Graphics;
  private g!: Phaser.GameObjects.Graphics;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes = new Map<number, number>();
  private hurtFlash = 0;
  private drawnFloor = -1;
  private reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(
    private controller: Controller,
    private sfx: Sfx,
    private onFrame: () => void,
  ) {
    super('run');
  }

  create(): void {
    this.bg = this.add.graphics().setScale(RENDER_SCALE);
    this.g = this.add.graphics().setScale(RENDER_SCALE);
    this.drawBackground(1);
  }

  update(_time: number, delta: number): void {
    this.controller.advance(delta);
    const state = this.controller.state;
    if (state) {
      if (state.floor !== this.drawnFloor) this.drawBackground(state.floor);
      this.updateEffects(delta, !this.controller.paused && state.phase === 'play');
      this.draw(state);
    }
    this.onFrame();
  }

  handleEvents(events: SimEvent[]): void {
    const state = this.controller.state;
    for (const ev of events) {
      switch (ev.t) {
        case 'shoot':
          this.sfx.play('shoot');
          break;
        case 'hit':
          this.flashes.set(ev.id, 5);
          this.burst(ev.x, ev.y, 3, COLORS.shot, 70);
          this.sfx.play('hit');
          break;
        case 'kill':
          this.burst(ev.x, ev.y, 12, COLORS.enemy[ev.type] ?? 0xffffff, 150);
          if (this.rings.length < 24) this.rings.push({ x: ev.x, y: ev.y, r: 26, life: 0.25, max: 0.25, color: 0xffffff });
          this.shake(70, 0.004);
          this.sfx.play('kill');
          break;
        case 'hurt':
          this.hurtFlash = 0.25;
          this.shake(180, 0.012);
          this.sfx.play('hurt');
          vibrate(40);
          break;
        case 'spit':
          this.sfx.play('spit');
          break;
        case 'windup':
          this.sfx.play('windup');
          break;
        case 'nova':
          this.rings.push({ x: ev.x, y: ev.y, r: ev.r, life: 0.35, max: 0.35, color: COLORS.player });
          this.shake(90, 0.006);
          this.sfx.play('nova');
          break;
        case 'pickup':
          if (state) this.burst(state.player.x, state.player.y, 8, COLORS.heart, 90);
          this.sfx.play('pickup');
          break;
        case 'exit':
          if (state?.exit) {
            this.rings.push({ x: state.exit.x, y: state.exit.y, r: 70, life: 0.5, max: 0.5, color: COLORS.exit });
          }
          this.sfx.play('exit');
          break;
        case 'climb':
          this.particles.length = 0;
          this.flashes.clear();
          if (state) {
            this.rings.push({ x: state.player.x, y: state.player.y, r: 140, life: 0.5, max: 0.5, color: COLORS.exit });
          }
          if (!this.reducedMotion) this.cameras.main.flash(160, 122, 215, 255);
          this.sfx.play('climb');
          vibrate(15);
          break;
        case 'segmentEnd':
          this.sfx.play('timeup');
          vibrate([30, 40, 30]);
          break;
        case 'dead':
          if (state) this.burst(state.player.x, state.player.y, 40, COLORS.player, 220);
          this.shake(400, 0.02);
          this.sfx.play('dead');
          vibrate(250);
          break;
      }
    }
  }

  private shake(duration: number, intensity: number): void {
    if (!this.reducedMotion) this.cameras.main.shake(duration, intensity);
  }

  private burst(x: number, y: number, count: number, color: number, speed: number): void {
    if (this.particles.length > 300) return;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      const life = 0.2 + Math.random() * 0.3;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life,
        max: life,
        color,
        r: 1.5 + Math.random() * 2,
      });
    }
  }

  private updateEffects(deltaMs: number, running: boolean): void {
    const dt = Math.min(deltaMs, 100) / 1000;
    let kept = 0;
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      if (p.life > 0) this.particles[kept++] = p;
    }
    this.particles.length = kept;

    kept = 0;
    for (const r of this.rings) {
      r.life -= dt;
      if (r.life > 0) this.rings[kept++] = r;
    }
    this.rings.length = kept;

    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (running) {
      for (const [id, frames] of this.flashes) {
        if (frames <= 1) this.flashes.delete(id);
        else this.flashes.set(id, frames - 1);
      }
    }
  }

  private drawBackground(floor: number): void {
    const { width, height } = this.controller.cfg.tuning.arena;
    const [a, b, edge] = PALETTES[Math.floor((floor - 1) / 3) % PALETTES.length];
    const tile = 40;
    const bg = this.bg;
    bg.clear();
    for (let j = 0; j * tile < height; j++) {
      for (let i = 0; i * tile < width; i++) {
        // A cheap position hash so each floor gets its own scuffed-tile pattern.
        const h = Math.imul(i * 73856093 + j * 19349663 + floor * 83492791, 2654435761) >>> 0;
        bg.fillStyle(h % 5 === 0 ? b : a, 1);
        bg.fillRect(i * tile, j * tile, tile, tile);
        if (h % 11 === 0) {
          bg.fillStyle(edge, 0.35);
          bg.fillRect(i * tile + 6 + (h % 20), j * tile + 8 + ((h >> 5) % 20), 5, 2);
        }
      }
    }
    bg.lineStyle(1, edge, 0.35);
    for (let i = 1; i * tile < width; i++) bg.lineBetween(i * tile, 0, i * tile, height);
    for (let j = 1; j * tile < height; j++) bg.lineBetween(0, j * tile, width, j * tile);
    bg.lineStyle(6, edge, 1);
    bg.strokeRect(0, 0, width, height);
    this.drawnFloor = floor;
  }

  private draw(state: RunState): void {
    const g = this.g;
    const cfg = this.controller.cfg;
    const now = this.time.now;
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    g.clear();

    if (state.exit) {
      const { x, y } = state.exit;
      const r = cfg.tuning.floor.exitRadius;
      g.fillStyle(COLORS.exit, 0.1 + 0.1 * pulse);
      g.fillCircle(x, y, r + 14 + 6 * pulse);
      g.fillStyle(0x0d1a24, 0.9);
      g.fillCircle(x, y, r);
      g.lineStyle(2.5, COLORS.exit, 1);
      g.strokeCircle(x, y, r);
      g.fillStyle(COLORS.exit, 1);
      for (let i = 0; i < 3; i++) g.fillRect(x - 9 + i * 3, y + 5 - i * 6, 18 - i * 6, 3);
    }

    for (const d of state.drops) {
      const blink = d.life < 120 && Math.floor(d.life / 8) % 2 === 0;
      if (blink) continue;
      const r = cfg.tuning.drops.heartRadius;
      g.fillStyle(COLORS.heart, 0.2);
      g.fillCircle(d.x, d.y, r + 4 + 2 * pulse);
      g.fillStyle(COLORS.heart, 1);
      g.fillCircle(d.x, d.y, r);
      g.fillStyle(0xffffff, 1);
      g.fillRect(d.x - 1.5, d.y - 5, 3, 10);
      g.fillRect(d.x - 5, d.y - 1.5, 10, 3);
    }

    for (const p of state.pillars) {
      g.fillStyle(0x000000, 0.35);
      g.fillCircle(p.x + 3, p.y + 5, p.r);
      g.fillStyle(COLORS.pillar, 1);
      g.fillCircle(p.x, p.y, p.r);
      g.fillStyle(COLORS.pillarTop, 1);
      g.fillCircle(p.x - p.r * 0.12, p.y - p.r * 0.16, p.r * 0.74);
    }

    const pl = state.player;
    for (const e of state.enemies) {
      const def = enemyDef(cfg, e.type);
      const r = def.radius;
      const flash = this.flashes.has(e.id);
      const color = flash ? 0xffffff : (COLORS.enemy[e.type] ?? 0xcccccc);
      let dx = pl.x - e.x;
      let dy = pl.y - e.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d;
      dy /= d;

      g.fillStyle(0x000000, 0.3);
      g.fillCircle(e.x + 2, e.y + 4, r);

      if (def.behavior === 'dash') {
        const fx = e.mode === 0 ? dx : e.vx;
        const fy = e.mode === 0 ? dy : e.vy;
        if (e.mode === 1) {
          // Telegraph the charge so it can be dodged.
          const reach = (def.dashSpeed ?? 300) * (def.dashTime ?? 0.4);
          g.lineStyle(r * 1.6, 0xff4d6d, 0.12 + 0.12 * pulse);
          g.lineBetween(e.x, e.y, e.x + fx * reach, e.y + fy * reach);
        }
        const warn = e.mode === 1 && Math.floor(now / 70) % 2 === 0;
        g.fillStyle(warn ? 0xffffff : color, 1);
        g.fillTriangle(
          e.x + fx * r * 1.6,
          e.y + fy * r * 1.6,
          e.x - fx * r * 0.9 - fy * r,
          e.y - fy * r * 0.9 + fx * r,
          e.x - fx * r * 0.9 + fy * r,
          e.y - fy * r * 0.9 - fx * r,
        );
      } else {
        g.fillStyle(color, 1);
        g.fillCircle(e.x, e.y, r);
        if (def.behavior === 'spit') {
          g.fillStyle(0x1c3a22, 1);
          g.fillCircle(e.x + dx * r * 0.45, e.y + dy * r * 0.45, r * 0.42);
        } else {
          g.fillStyle(0x3a1414, 1);
          g.fillCircle(e.x + dx * r * 0.45 - dy * r * 0.35, e.y + dy * r * 0.45 + dx * r * 0.35, r * 0.2);
          g.fillCircle(e.x + dx * r * 0.45 + dy * r * 0.35, e.y + dy * r * 0.45 - dx * r * 0.35, r * 0.2);
        }
      }

      if (e.hp < e.maxHp) {
        const w = r * 2;
        g.fillStyle(0x000000, 0.6);
        g.fillRect(e.x - r, e.y - r - 7, w, 3);
        g.fillStyle(0xff6b6b, 1);
        g.fillRect(e.x - r, e.y - r - 7, w * Math.max(0, e.hp / e.maxHp), 3);
      }
    }

    for (const s of state.spits) {
      g.fillStyle(COLORS.spit, 0.25);
      g.fillCircle(s.x, s.y, s.r + 4);
      g.fillStyle(COLORS.spit, 1);
      g.fillCircle(s.x, s.y, s.r);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(s.x, s.y, s.r * 0.4);
    }

    const projR = cfg.tuning.player.projRadius;
    for (const s of state.shots) {
      g.lineStyle(projR * 1.2, COLORS.shot, 0.35);
      g.lineBetween(s.x - s.vx * 2.2, s.y - s.vy * 2.2, s.x, s.y);
      g.fillStyle(COLORS.shot, 1);
      g.fillCircle(s.x, s.y, projR);
    }

    if (state.phase !== 'dead') {
      const r = cfg.tuning.player.radius;
      const flicker = 0.9 + 0.1 * Math.sin(now / 60);
      g.fillStyle(COLORS.player, 0.06);
      g.fillCircle(pl.x, pl.y, 70 * flicker);
      g.fillStyle(COLORS.player, 0.1);
      g.fillCircle(pl.x, pl.y, 38 * flicker);
      const blink = pl.invuln > 0 && Math.floor(now / 60) % 2 === 0;
      g.fillStyle(this.hurtFlash > 0 ? 0xffffff : COLORS.player, blink ? 0.45 : 1);
      g.fillCircle(pl.x, pl.y, r);
      g.fillStyle(COLORS.playerCore, blink ? 0.45 : 1);
      g.fillCircle(pl.x + pl.ax * 3, pl.y + pl.ay * 3, r * 0.5);
    }

    for (const ring of this.rings) {
      const k = 1 - ring.life / ring.max;
      g.lineStyle(3, ring.color, 1 - k);
      g.strokeCircle(ring.x, ring.y, ring.r * (0.25 + 0.75 * k));
    }
    for (const p of this.particles) {
      g.fillStyle(p.color, Math.max(0, p.life / p.max));
      g.fillCircle(p.x, p.y, p.r);
    }

    if (this.hurtFlash > 0) {
      const { width, height } = cfg.tuning.arena;
      g.lineStyle(26, 0xff2d4a, Math.min(0.5, this.hurtFlash * 2));
      g.strokeRect(0, 0, width, height);
    }
  }
}
