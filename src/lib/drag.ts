// Pointer-driven move/resize for boxes and widgets. While dragging, only a CSS transform changes;
// the store is written once on release.

import { popCapture, pushCapture } from "./hit";
import type { Rect } from "./types";

export const snap = (v: number, grid: number) => (grid > 1 ? Math.round(v / grid) * grid : Math.round(v));

export type DragMode = "move" | "resize";

export function startFrameDrag(
  e: React.PointerEvent,
  el: HTMLElement,
  rect: Rect,
  mode: DragMode,
  opts: { grid: number; min: { w: number; h: number }; bounds: { w: number; h: number }; onCommit: (r: Rect) => void },
) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX;
  const sy = e.clientY;
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  pushCapture();
  let next = rect;
  el.dataset.dragging = "1";

  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (mode === "move") {
      const x = Math.max(0, Math.min(opts.bounds.w - rect.w, snap(rect.x + dx, opts.grid)));
      const y = Math.max(0, Math.min(opts.bounds.h - 32, snap(rect.y + dy, opts.grid)));
      next = { ...rect, x, y };
      el.style.transform = `translate(${x - rect.x}px, ${y - rect.y}px)`;
    } else {
      const w = Math.max(opts.min.w, Math.min(opts.bounds.w - rect.x, snap(rect.w + dx, opts.grid)));
      const h = Math.max(opts.min.h, Math.min(opts.bounds.h - rect.y, snap(rect.h + dy, opts.grid)));
      next = { ...rect, w, h };
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
  };
  const up = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
    el.style.transform = "";
    delete el.dataset.dragging;
    popCapture();
    if (next !== rect) opts.onCommit(next);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}
