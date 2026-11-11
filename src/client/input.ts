import type { Controller } from './controller';

/** CSS pixels of drag that count as full speed. */
const FULL_DRAG = 42;

/**
 * Drag anywhere to move: the first touch sets an origin, and the drag direction from that origin
 * is the move direction. The origin trails the finger so reversing direction is always quick.
 * Arrow keys and WASD work on desktop.
 */
export function attachInput(controller: Controller, surface: HTMLElement): void {
  const base = document.createElement('div');
  base.className = 'stick-base';
  const knob = document.createElement('div');
  knob.className = 'stick-knob';
  base.appendChild(knob);
  document.body.appendChild(base);

  let pointerId: number | null = null;
  let ox = 0;
  let oy = 0;
  const keys = new Set<string>();

  const playing = () => !controller.paused && controller.phase() === 'play';

  const release = () => {
    pointerId = null;
    base.classList.remove('on');
    applyKeys();
  };

  const applyKeys = () => {
    if (pointerId !== null) return;
    const x = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const y = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
    const len = Math.sqrt(x * x + y * y) || 1;
    controller.setInput((x / len) * 100, (y / len) * 100);
  };

  surface.addEventListener('pointerdown', (e) => {
    if (!playing() || pointerId !== null) return;
    if ((e.target as HTMLElement).closest('button, input, .panel')) return;
    pointerId = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    base.style.left = `${ox}px`;
    base.style.top = `${oy}px`;
    knob.style.transform = 'translate(-50%, -50%)';
    base.classList.add('on');
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    if (!playing()) {
      release();
      return;
    }
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > FULL_DRAG) {
      // Drag the origin along behind the finger.
      ox += (dx / len) * (len - FULL_DRAG);
      oy += (dy / len) * (len - FULL_DRAG);
      dx = e.clientX - ox;
      dy = e.clientY - oy;
      base.style.left = `${ox}px`;
      base.style.top = `${oy}px`;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    controller.setInput((dx / FULL_DRAG) * 100, (dy / FULL_DRAG) * 100);
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId === pointerId) release();
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  const keyName = (code: string): string | null => {
    switch (code) {
      case 'ArrowLeft':
      case 'KeyA':
        return 'left';
      case 'ArrowRight':
      case 'KeyD':
        return 'right';
      case 'ArrowUp':
      case 'KeyW':
        return 'up';
      case 'ArrowDown':
      case 'KeyS':
        return 'down';
      default:
        return null;
    }
  };
  window.addEventListener('keydown', (e) => {
    const name = keyName(e.code);
    if (!name) return;
    keys.add(name);
    applyKeys();
    if (playing()) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const name = keyName(e.code);
    if (!name) return;
    keys.delete(name);
    applyKeys();
  });
  window.addEventListener('blur', () => {
    keys.clear();
    release();
  });

  // Stop the page from scrolling, zooming or showing a context menu mid-run.
  surface.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}
