// Pointer-driven move/resize for boxes and widgets. While dragging, only a CSS transform changes;
// the store is written once on release. A move that leaves the surface asks Rust for the monitor
// under the pointer, which draws a ghost there; releasing on it hands the frame over (`onLand`).

import { popCapture, pushCapture } from "./hit";
import { ipc, type Landing } from "./ipc";
import { fitZone, snapAt, useSnap, wantsFlyout } from "./snap";
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
    /** Allows dropping on another monitor. `at` carries a size when dropped on a snap zone. */
    cross?: { frame: Pick<DragFrame, "coll" | "id" | "title">; onLand: (monitor: string, at: { x: number; y: number; w?: number; h?: number }) => void };
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
  // Snap-layout flyout at the top edge (moves only): the zone under the cursor on release.
  let snapOpen = false;
  let zone: Rect | null = null;
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
      const inWindow = ev.clientX >= 0 && ev.clientY >= 0 && ev.clientX < innerWidth && ev.clientY < innerHeight;
      const open = inWindow && wantsFlyout(snapOpen, innerWidth, ev.clientX, ev.clientY);
      const hit = open ? snapAt(innerWidth, innerHeight, ev.clientX, ev.clientY) : null;
      zone = hit ? fitZone(hit.rect, opts.min, opts.bounds.w, opts.bounds.h) : null;
      el.style.opacity = zone ? "0.45" : "";
      if (open !== snapOpen || open) useSnap.setState({ open, cx: ev.clientX, cy: ev.clientY });
      snapOpen = open;
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
    if (snapOpen) useSnap.setState({ open: false });
    if (zone) {
      // Snapped into a zone on this desktop: move and resize in one go.
      if (crossed) void ipc.dragEnd(frame()).catch(() => null); // clears a ghost left on another monitor
      opts.onCommit(zone);
      return;
    }
    if (!crossed) {
      if (next !== rect) opts.onCommit(next);
      return;
    }
    ipc
      .dragEnd(frame())
      .catch(() => null)
      .then((landing) => {
        if (!landing) {
          if (next !== rect) opts.onCommit(next);
          return;
        }
        const z = landingZone(landing, opts.min);
        cross!.onLand(landing.monitor, z ?? { x: snap(landing.x, opts.grid), y: snap(landing.y, opts.grid) });
      });
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}

/** The snap zone a frame dropped on another surface lands in, if the cursor was on one. */
export function landingZone(l: Landing, min: { w: number; h: number }): Rect | null {
  const hit = snapAt(l.sw, l.sh, l.cx, l.cy);
  return hit ? fitZone(hit.rect, min, l.sw, l.sh) : null;
}

/**
 * Drags something new (a widget or a box from the manager's gallery) out of the manager window
 * onto a desktop. Over a desktop, that surface shows a ghost and the snap-layout flyout; release
 * on a zone to snap it there, anywhere else to drop it under the cursor. Returns via `onDrop`.
 */
export function startPlaceDrag(
  e: React.PointerEvent,
  item: { kind: "widgets" | "boxes"; title: string; w: number; h: number; min: { w: number; h: number } },
  hooks: { onMove: (p: { x: number; y: number; outside: boolean } | null) => void; onDrop: (monitor: string, r: Rect) => void },
) {
  if (e.button !== 0) return;
  e.preventDefault();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  let outside = false;
  let inFlight = false;
  let again = false;
  const frame = (): DragFrame => ({ coll: item.kind, id: "new", title: item.title, w: item.w, h: item.h, grabX: Math.min(40, item.w / 2), grabY: 16 });
  const ask = () => {
    if (inFlight) return void (again = true);
    inFlight = true;
    ipc.dragOver(frame()).catch(() => {}).finally(() => {
      inFlight = false;
      if (again) {
        again = false;
        ask();
      }
    });
  };
  const move = (ev: PointerEvent) => {
    if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    started = true;
    const out = ev.clientX < 0 || ev.clientY < 0 || ev.clientX >= innerWidth || ev.clientY >= innerHeight;
    if (out || outside) ask();
    outside = out;
    hooks.onMove({ x: ev.clientX, y: ev.clientY, outside: out });
  };
  const up = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
    hooks.onMove(null);
    if (!started) return;
    ipc
      .dragEnd(frame())
      .catch(() => null)
      .then((l) => {
        if (!l) return;
        const z = landingZone(l, item.min);
        hooks.onDrop(l.monitor, z ?? { x: snap(l.x, 1), y: snap(l.y, 1), w: item.w, h: item.h });
      });
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}
