// Windows 11 style snap layouts for boxes and widgets.
//
// While a box or widget is dragged to the top edge of a desktop, or a new one is dragged out of
// the widget gallery, a flyout of layouts drops down at the top centre. Each layout tile is split
// into zones; releasing over a zone places the frame there, sized to that part of the screen.
// Everything here is pure geometry in surface CSS px, so the surface (drawing the flyout) and the
// manager (creating the widget after a drop) compute the same answer.

import { create } from "zustand";
import type { Rect } from "./types";

/** Zones as fractions of the work area: [x, y, w, h]. */
export type Layout = [number, number, number, number][];

const grid = (cols: number, rows: number): Layout =>
  Array.from({ length: cols * rows }, (_, i) => [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows]);

export const LAYOUTS: Layout[] = [
  [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
  [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
  [[0, 0, 0.25, 1], [0.25, 0, 0.5, 1], [0.75, 0, 0.25, 1]],
  [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  grid(2, 2),
  grid(3, 2),
  grid(4, 3),
];

const TILE_W = 66;
const TILE_H = 44;
const TILE_GAP = 10;
const PAD = 10;
const TOP = 10;
/** Inner gap between a zone tile's cells. */
const CELL_GAP = 3;
/** Margin kept around a frame snapped into a zone. */
const MARGIN = 10;
/** How close to the top edge a drag must come to open the flyout. */
export const REVEAL_PX = 48;

export type FlyoutGeom = { x: number; y: number; w: number; h: number; tiles: Rect[] };

export function flyout(sw: number): FlyoutGeom {
  const w = PAD * 2 + LAYOUTS.length * TILE_W + (LAYOUTS.length - 1) * TILE_GAP;
  const h = PAD * 2 + TILE_H;
  const x = Math.round((sw - w) / 2);
  const tiles = LAYOUTS.map((_, i) => ({ x: x + PAD + i * (TILE_W + TILE_GAP), y: TOP + PAD, w: TILE_W, h: TILE_H }));
  return { x, y: TOP, w, h, tiles };
}

/** A zone cell inside a layout tile, in surface px. */
export function cellRect(tile: Rect, z: Layout[number]): Rect {
  return {
    x: tile.x + z[0] * tile.w + CELL_GAP / 2,
    y: tile.y + z[1] * tile.h + CELL_GAP / 2,
    w: z[2] * tile.w - CELL_GAP,
    h: z[3] * tile.h - CELL_GAP,
  };
}

const inside = (r: Rect, x: number, y: number, pad = 0) => x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad;

export type SnapHit = { layout: number; zone: number; rect: Rect };

/** The zone under the cursor, and where a frame dropped there goes. */
export function snapAt(sw: number, sh: number, cx: number, cy: number): SnapHit | null {
  const f = flyout(sw);
  if (!inside(f, cx, cy)) return null;
  for (let l = 0; l < LAYOUTS.length; l++) {
    const tile = f.tiles[l];
    if (!inside(tile, cx, cy, TILE_GAP / 2)) continue;
    // Nearest cell, so the thin gaps between cells still count.
    let best = -1;
    let dist = Infinity;
    LAYOUTS[l].forEach((z, i) => {
      const c = cellRect(tile, z);
      const dx = Math.max(c.x - cx, 0, cx - (c.x + c.w));
      const dy = Math.max(c.y - cy, 0, cy - (c.y + c.h));
      const d = dx * dx + dy * dy;
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    const z = LAYOUTS[l][best];
    const rect = {
      x: Math.round(z[0] * sw + MARGIN),
      y: Math.round(z[1] * sh + MARGIN),
      w: Math.round(z[2] * sw - MARGIN * 2),
      h: Math.round(z[3] * sh - MARGIN * 2),
    };
    return { layout: l, zone: best, rect };
  }
  return null;
}

/** Keeps a snapped frame within the widget's / box's minimum size and the screen. */
export function fitZone(r: Rect, min: { w: number; h: number }, sw: number, sh: number): Rect {
  const w = Math.max(min.w, r.w);
  const h = Math.max(min.h, r.h);
  return { x: Math.max(0, Math.min(r.x, sw - w)), y: Math.max(0, Math.min(r.y, sh - h)), w, h };
}

/** Whether a drag at this point should show (or keep showing) the flyout. */
export function wantsFlyout(open: boolean, sw: number, cx: number, cy: number): boolean {
  if (cy <= REVEAL_PX) return true;
  if (!open) return false;
  const f = flyout(sw);
  return inside(f, cx, cy, 40);
}

/** Flyout state of an in-surface drag (boxes and widgets moved on this desktop). */
export const useSnap = create<{ open: boolean; cx: number; cy: number }>(() => ({ open: false, cx: 0, cy: 0 }));
