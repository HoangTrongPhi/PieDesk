// Pointer-driven move/resize for boxes and widgets. While dragging, only a CSS transform changes;
// the store is written once on release. A move that leaves the surface asks Rust for the monitor
// under the pointer, which draws a ghost there; releasing on it hands the frame over (`onLand`).

import { popCapture, pushCapture } from "./hit";
import { ipc } from "./ipc";
import type { DragFrame, Rect } from "./types";

export const snap = (v: number, grid: number) => (grid > 1 ? Math.round(v / grid) * grid : Math.round(v));

export type DragMode = "move" | "resize";

export function startFrameDrag(
  e: React.PointerEvent,
  el: HTMLElement,
  rect: Rect,
  mode: DragMode,
  opts: {
    grid: number;
    min: { w: number; h: number };
    bounds: { w: number; h: number };
    onCommit: (r: Rect) => void;
    /** Allows dropping on another monitor. */
    cross?: { frame: Pick<DragFrame, "coll" | "id" | "title">; onLand: (monitor: string, at: { x: number; y: number }) => void };
  },
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

  const cross = mode === "move" ? opts.cross : undefined;
  const frame = (): DragFrame => ({ ...cross!.frame, w: rect.w, h: rect.h, grabX: sx - rect.x, grabY: sy - rect.y });
  let outside = false;
  let crossed = false;
  let inFlight = false;
  let again = false;
  const askAway = () => {
    if (inFlight) return void (again = true);
    inFlight = true;
    ipc
      .dragOver(frame())
      .then((monitor) => (el.style.opacity = outside && monitor ? "0.35" : ""))
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        if (again) {
          again = false;
          askAway();
        }
      });
  };

  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (mode === "move") {
      const x = Math.max(0, Math.min(opts.bounds.w - rect.w, snap(rect.x + dx, opts.grid)));
      const y = Math.max(0, Math.min(opts.bounds.h - 32, snap(rect.y + dy, opts.grid)));
      next = { ...rect, x, y };
      el.style.transform = `translate(${x - rect.x}px, ${y - rect.y}px)`;
      if (cross) {
        const out = ev.clientX < 0 || ev.clientY < 0 || ev.clientX >= innerWidth || ev.clientY >= innerHeight;
        // Keep asking while outside; one more call on the way back clears the ghost.
        if (out || outside) {
          outside = out;
          crossed = true;
          askAway();
        }
      }
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
    el.style.opacity = "";
    delete el.dataset.dragging;
    popCapture();
    if (!crossed) {
      if (next !== rect) opts.onCommit(next);
      return;
    }
    ipc
      .dragEnd(frame())
      .catch(() => null)
      .then((landing) => {
        if (landing) cross!.onLand(landing.monitor, { x: snap(landing.x, opts.grid), y: snap(landing.y, opts.grid) });
        else if (next !== rect) opts.onCommit(next);
      });
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}
