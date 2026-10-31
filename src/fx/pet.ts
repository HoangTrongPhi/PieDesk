// "Pie", the desktop cat. Walks along the tops of boxes and the bottom of the screen, jumps up
// onto nearby boxes, falls off the end of one, sits, and naps. Pure canvas, no assets.

import { rand, type FxContext, type FxDef, type Obstacle } from "./types";

const GRAVITY = 900;
const WALK = 42;

type State = "walk" | "sit" | "sleep" | "air";

export function pet(): FxDef {
  return {
    layer: "front",
    make: () => {
      let x = -1;
      let y = 0;
      let vx = 0;
      let vy = 0;
      let dir = 1;
      let state: State = "air";
      let until = 0;
      let on: string | null = null;

      /** The highest surface under x at or below y: a box top or the floor. */
      const ground = (c: FxContext, px: number, py: number): { top: number; id: string | null } => {
        let best: { top: number; id: string | null } = { top: c.floor, id: null };
        for (const o of c.obstacles) if (px >= o.x + 4 && px <= o.x + o.w - 4 && o.y >= py - 1 && o.y < best.top) best = { top: o.y, id: o.id };
        return best;
      };
      const rest = (c: FxContext, s: State, min: number, max: number) => {
        state = s;
        until = c.t + rand(min, max);
      };

      return (c) => {
        if (x < 0) {
          x = rand(80, c.w - 80);
          y = -40;
        }
        const support: Obstacle | undefined = on ? c.obstacles.find((o) => o.id === on) : undefined;
        if (state !== "air") {
          if (on && (!support || x < support.x || x > support.x + support.w)) {
            state = "air"; // box moved away or walked off the end
            vx = dir * WALK;
            vy = 0;
            on = null;
          } else {
            y = support ? support.y : c.floor;
          }
        }

        if (state === "air") {
          const prev = y;
          vy += GRAVITY * c.dt;
          x += vx * c.dt;
          y += vy * c.dt;
          if (x < 10 || x > c.w - 10) {
            x = Math.min(c.w - 10, Math.max(10, x));
            vx = 0;
          }
          const g = ground(c, x, prev);
          if (vy > 0 && y >= g.top) {
            y = g.top;
            on = g.id;
            vx = vy = 0;
            rest(c, "sit", 0.6, 1.6);
          }
        } else if (state === "walk") {
          x += dir * WALK * c.dt;
          if (!on && (x < 16 || x > c.w - 16)) dir = -dir;
          if (c.t > until) {
            const r = Math.random();
            const jump = r < 0.45 && target(c);
            if (jump) {
              const T = 0.75;
              vx = (jump.x - x) / T;
              vy = (jump.top - y - 0.5 * GRAVITY * T * T) / T;
              dir = Math.sign(vx) || dir;
              state = "air";
              on = null;
            } else if (r < 0.8) rest(c, "sit", 2, 6);
            else until = c.t + rand(2, 5);
          }
        } else if (c.t > until) {
          if (state === "sit" && Math.random() < 0.25) rest(c, "sleep", 6, 14);
          else {
            dir = Math.random() < 0.5 ? -1 : 1;
            rest(c, "walk", 2, 6);
          }
        }
        draw(c, x, y, dir, state);
      };

      /** A box top up to ~220 px higher and up to 260 px ahead to jump onto. */
      function target(c: FxContext) {
        const options = c.obstacles
          .filter((o) => o.id !== on && o.y < y - 20 && o.y > y - 220)
          .map((o) => ({ top: o.y, x: Math.min(o.x + o.w - 20, Math.max(o.x + 20, x + dir * 120)) }))
          .filter((p) => Math.abs(p.x - x) < 260 && Math.sign(p.x - x) !== -dir);
        return options.length ? options[Math.floor(Math.random() * options.length)] : null;
      }
    },
  };
}

function draw(c: FxContext, x: number, y: number, dir: number, state: State) {
  const { ctx, t } = c;
  const body = "#f4a261";
  const dark = "#c26a2b";
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.shadowColor = "rgb(0 0 0 / 0.35)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = body;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  if (state === "sleep") {
    // Curled up loaf with the tail around it.
    ctx.beginPath();
    ctx.ellipse(0, -8, 17, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-4, -6, 16, 0.2, 1.6);
    ctx.stroke();
    head(ctx, 12, -11, true);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgb(255 255 255 / 0.85)";
    ctx.font = "bold 10px Segoe UI, sans-serif";
    const z = (t * 0.8) % 1;
    ctx.globalAlpha = 1 - z;
    ctx.scale(dir, 1);
    ctx.fillText("z", 14 * dir + 4, -26 - z * 14);
    ctx.restore();
    return;
  }

  const sit = state === "sit";
  const step = state === "walk" ? Math.sin(t * 12) : 0;
  // Tail.
  ctx.beginPath();
  ctx.moveTo(-14, sit ? -6 : -12);
  ctx.quadraticCurveTo(-26, sit ? -4 : -20 + Math.sin(t * 3) * 3, -24, sit ? -1 : -28 + Math.sin(t * 3) * 4);
  ctx.stroke();
  // Legs.
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = body;
  ctx.beginPath();
  if (sit) {
    ctx.moveTo(6, -6);
    ctx.lineTo(7, 0);
    ctx.moveTo(10, -6);
    ctx.lineTo(11, 0);
  } else {
    for (const [lx, ph] of [[-9, 0], [-5, Math.PI], [7, Math.PI], [11, 0]] as const) {
      ctx.moveTo(lx, -6);
      ctx.lineTo(lx + Math.sin(ph) * 0 + step * (ph ? -3 : 3), 0);
    }
  }
  ctx.stroke();
  // Body and stripes.
  ctx.beginPath();
  if (sit) ctx.ellipse(-2, -10, 12, 10, -0.5, 0, Math.PI * 2);
  else ctx.ellipse(0, -10, 16, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const sx of [-6, -1, 4]) {
    ctx.moveTo(sx, sit ? -18 : -16);
    ctx.lineTo(sx + 1.5, sit ? -12 : -11);
  }
  ctx.stroke();
  head(ctx, sit ? 9 : 15, sit ? -21 : -15, false, state === "air");
  ctx.restore();
}

function head(ctx: CanvasRenderingContext2D, hx: number, hy: number, asleep: boolean, wide = false) {
  ctx.fillStyle = "#f4a261";
  ctx.beginPath();
  ctx.arc(hx, hy, 7, 0, Math.PI * 2);
  ctx.moveTo(hx - 6, hy - 3);
  ctx.lineTo(hx - 4, hy - 11);
  ctx.lineTo(hx - 1, hy - 5);
  ctx.moveTo(hx + 1, hy - 5);
  ctx.lineTo(hx + 5, hy - 11);
  ctx.lineTo(hx + 6, hy - 3);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#2b1b10";
  ctx.strokeStyle = "#2b1b10";
  ctx.lineWidth = 1.2;
  if (asleep) {
    ctx.beginPath();
    ctx.moveTo(hx - 1, hy);
    ctx.lineTo(hx + 1.5, hy);
    ctx.moveTo(hx + 3, hy);
    ctx.lineTo(hx + 5.5, hy);
    ctx.stroke();
  } else {
    const r = wide ? 1.6 : 1.2;
    ctx.beginPath();
    ctx.arc(hx + 0.5, hy - 1, r, 0, Math.PI * 2);
    ctx.arc(hx + 4.5, hy - 1, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#e76f8a";
  ctx.beginPath();
  ctx.arc(hx + 6.5, hy + 1.5, 1.1, 0, Math.PI * 2);
  ctx.fill();
}
