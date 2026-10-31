// Holiday ornaments on boxes and widgets, drawn from the SVG art in src/decor:
// - trim (front layer): a sprite over the top corners, small things sitting on the top edge,
//   a strip (icicles) along the bottom edge;
// - hangers (back layer, under the boxes): baubles, lì xì, lanterns on strings below a box that
//   swing when the box is dragged; a spider rides its thread up and down.
// Which ornaments a box gets follows from its id, so they stay put across restarts.

import { drawSprite, sprite, spriteHeight } from "../decor/assets";
import type { FxDef, Obstacle } from "./types";

/** Deterministic random numbers for a box. */
function seeded(id: string) {
  let s = 2166136261;
  for (let i = 0; i < id.length; i++) s = Math.imul(s ^ id.charCodeAt(i), 16777619);
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type TrimDef = {
  /** Sprite over the top-left corner; `right` (or `left` mirrored) over the top-right one. */
  corner?: { left: string; right?: string; w: number; chance?: number; alpha?: number; inset?: number };
  /** Small sprites sitting on the top edge of some boxes. */
  sit?: { assets: string[]; w: number; chance: number };
  /** Strip tiled along the bottom edge (icicles); `h` is its drawn height. */
  strip?: { asset: string; h: number };
};

export function trim(def: TrimDef): FxDef {
  return {
    layer: "front",
    make: () => {
      type Plan = { left: boolean; right: boolean; sit: { key: string; fx: number } | null };
      const plans = new Map<string, Plan>();
      const plan = (o: Obstacle): Plan => {
        let p = plans.get(o.id);
        if (!p) {
          const r = seeded(o.id);
          const chance = def.corner?.chance ?? 1;
          const side = r() < 0.5 ? 0.12 + r() * 0.18 : 0.7 + r() * 0.18; // clear of the centred title
          p = {
            left: !!def.corner && r() < chance,
            right: !!def.corner && r() < chance * 0.75,
            sit: def.sit && r() < def.sit.chance ? { key: def.sit.assets[Math.floor(r() * def.sit.assets.length)], fx: side } : null,
          };
          plans.set(o.id, p);
        }
        return p;
      };
      return (c) => {
        const { ctx } = c;
        for (const o of c.obstacles) {
          const p = plan(o);
          if (def.strip) {
            const h = def.strip.h;
            const tile = sprite(def.strip.asset, h * 5);
            if (tile) {
              const tw = (tile.width / tile.height) * h;
              const x0 = o.x + 12;
              const x1 = o.x + o.w - 12;
              ctx.save();
              ctx.beginPath();
              ctx.rect(x0, o.y + o.h - 2, x1 - x0, h + 2);
              ctx.clip();
              for (let x = x0; x < x1; x += tw) ctx.drawImage(tile, x, o.y + o.h - 2, tw, h);
              ctx.restore();
            }
          }
          if (def.corner) {
            const { w, inset = -3, alpha = 1 } = def.corner;
            ctx.globalAlpha = alpha;
            const l = p.left && sprite(def.corner.left, w);
            if (l) drawSprite(ctx, l, o.x + inset, o.y + inset, w, 0, 0);
            const r = p.right && sprite(def.corner.right ?? def.corner.left, w, !def.corner.right);
            if (r) drawSprite(ctx, r, o.x + o.w - inset, o.y + inset, w, 1, 0);
            ctx.globalAlpha = 1;
          }
          if (p.sit) {
            const s = sprite(p.sit.key, def.sit!.w);
            if (s) drawSprite(ctx, s, o.x + p.sit.fx * o.w, o.y + 3, def.sit!.w, 0.5, 1);
          }
        }
      };
    },
  };
}

export type HangDef = {
  /** Sprites to pick from, with their drawn width. */
  assets: Record<string, number>;
  /** About one hanger per this many px of box width, each slot kept with `chance`. */
  spacing: number;
  chance: number;
  /** String length range, px. */
  len: [number, number];
  string: string;
  /** This sprite climbs up and down its thread instead of swinging much. */
  climber?: string;
};

type Hanger = { key: string; w: number; fx: number; len: number; th: number; om: number; phase: number };

export function hangers(def: HangDef): FxDef {
  return {
    layer: "back",
    make: () => {
      const keys = Object.keys(def.assets);
      const boxes = new Map<string, { list: Hanger[]; x: number; vx: number }>();
      const build = (o: Obstacle) => {
        const r = seeded(`${o.id}#hang`);
        const slots = Math.max(1, Math.floor(o.w / def.spacing));
        const list: Hanger[] = [];
        for (let i = 0; i < slots; i++) {
          if (r() > def.chance) continue;
          const key = keys[Math.floor(r() * keys.length)];
          list.push({
            key,
            w: def.assets[key],
            fx: (i + 0.25 + r() * 0.5) / slots,
            len: def.len[0] + r() * (def.len[1] - def.len[0]),
            th: 0,
            om: 0,
            phase: r() * 6.28,
          });
        }
        return { list, x: o.x, vx: 0 };
      };
      return (c) => {
        const { ctx, dt, t } = c;
        ctx.lineWidth = 1;
        for (const o of c.obstacles) {
          let b = boxes.get(o.id);
          if (!b) boxes.set(o.id, (b = build(o)));
          // The box's sideways acceleration drives the pendulums.
          const vx = dt > 0 ? (o.x - b.x) / dt : 0;
          const ax = Math.max(-8000, Math.min(8000, dt > 0 ? (vx - b.vx) / dt : 0));
          b.x = o.x;
          b.vx = vx;
          for (const h of b.list) {
            const climber = h.key === def.climber;
            // A climber goes down, waits, climbs back up and rests, over a 16 s loop.
            const k = climber ? climbCycle((t + h.phase * 3) % 16) : 1;
            const len = 4 + (h.len - 4) * k;
            const L = len + spriteHeight(h.key, h.w) * 0.5 + 8;
            for (let step = 0; step < 2; step++) {
              const sdt = dt / 2;
              h.om += (-(900 / L) * Math.sin(h.th) - 2.2 * h.om - (ax / L) * Math.cos(h.th)) * sdt;
              h.th = Math.max(-1.3, Math.min(1.3, h.th + h.om * sdt));
            }
            const th = h.th + Math.sin(t * 1.1 + h.phase) * (climber ? 0.02 : 0.05);
            const x0 = o.x + h.fx * o.w;
            const y0 = o.y + o.h - 1;
            const x1 = x0 + Math.sin(th) * len;
            const y1 = y0 + Math.cos(th) * len;
            ctx.strokeStyle = def.string;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
            const s = sprite(h.key, h.w);
            if (!s) continue;
            ctx.save();
            ctx.translate(x1, y1);
            ctx.rotate(-th);
            drawSprite(ctx, s, 0, -1, h.w);
            ctx.restore();
          }
        }
      };
    },
  };
}

/** 0 (up at the box) → 1 (fully down) over a 16 s loop: down, wait, up, rest. */
function climbCycle(s: number) {
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (s < 3) return ease(s / 3);
  if (s < 9) return 1;
  if (s < 12) return 1 - ease((s - 9) / 3);
  return 0;
}
