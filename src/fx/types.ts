// Canvas effects shared by theme layers (on the desktop surface, around boxes) and the overlay
// window (above every app). An effect is a small simulation that draws one frame at a time; the
// runner (FxLayer) owns the canvas, the clock, pausing and the list of boxes.

/** A box or widget on screen, in CSS px. Effects land on, slide off or draw inside these. */
export type Obstacle = { id: string; x: number; y: number; w: number; h: number };

export type FxContext = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Seconds since the effect started, and since the last frame (capped). */
  t: number;
  dt: number;
  obstacles: Obstacle[];
  /** Last pointer position over the surface, if any. */
  pointer: { x: number; y: number } | null;
  /** The ground: bottom of the work area (above the taskbar). */
  floor: number;
};

export type Sim = (c: FxContext) => void;

export type FxDef = {
  /** back: under boxes (shows through their glass); front: over them. */
  layer: "back" | "front";
  /** Keeps the previous frame (matrix trails); otherwise the runner clears the canvas each frame. */
  trails?: boolean;
  make: () => Sim;
};

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** Limits drawing to the inside of every obstacle. Call between save() and restore(). */
export function clipToObstacles(c: FxContext, radius = 14) {
  c.ctx.beginPath();
  for (const o of c.obstacles) c.ctx.roundRect(o.x, o.y, o.w, o.h, radius);
  c.ctx.clip();
}

/** The obstacle whose top edge is under (x, y) within `band` px, if any. */
export function landingOn(c: FxContext, x: number, y: number, band = 6): Obstacle | undefined {
  return c.obstacles.find((o) => x >= o.x && x <= o.x + o.w && y >= o.y - band && y <= o.y + band);
}

/** Runs several effects of the same layer as one. */
export const compose = (layer: FxDef["layer"], ...defs: FxDef[]): FxDef => ({
  layer,
  trails: defs.some((d) => d.trails),
  make: () => {
    const sims = defs.map((d) => d.make());
    return (c) => sims.forEach((s) => s(c));
  },
});
