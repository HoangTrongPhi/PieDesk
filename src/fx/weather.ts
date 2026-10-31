// Things that fall: snow that piles up on boxes, petals and leaves that land and slide off,
// rain, rain on the glass of boxes, and fireflies.

import { clipToObstacles, landingOn, pick, rand, type FxContext, type FxDef, type Obstacle } from "./types";

type Flake = { x: number; y: number; r: number; vy: number; phase: number };

/**
 * Snow. With `pile`, flakes that hit the top of a box build a cap on it; moving the box shakes
 * the cap off as a little burst of flakes.
 */
export function snow({ count = 140, pile = true } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      const flakes: Flake[] = [];
      const piles = new Map<string, { at: string; depth: number }>();
      const spawn = (c: FxContext, top = false): Flake => ({
        x: rand(0, c.w),
        y: top ? rand(-40, -4) : rand(-c.h, c.h),
        r: rand(1, 3.2),
        vy: rand(22, 60),
        phase: rand(0, Math.PI * 2),
      });
      return (c) => {
        const { ctx } = c;
        while (flakes.length < count) flakes.push(spawn(c, flakes.length > 0 && c.t > 0.5));
        ctx.fillStyle = "rgb(255 255 255 / 0.9)";
        for (let i = flakes.length - 1; i >= 0; i--) {
          const f = flakes[i];
          f.y += f.vy * c.dt;
          f.x += Math.sin(c.t * 1.3 + f.phase) * 18 * c.dt;
          const hit = pile && f.y > 0 ? landingOn(c, f.x, f.y, 3) : undefined;
          if (hit) {
            const p = piles.get(hit.id) ?? { at: `${hit.x},${hit.y},${hit.w}`, depth: 0 };
            p.depth = Math.min(7, p.depth + 0.05 * f.r);
            piles.set(hit.id, p);
          }
          if (hit || f.y > c.floor + 4) {
            flakes[i] = spawn(c, true);
            continue;
          }
          ctx.globalAlpha = 0.5 + f.r / 7;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        drawPiles(c, piles, flakes);
      };
    },
  };
}

function drawPiles(c: FxContext, piles: Map<string, { at: string; depth: number }>, flakes: Flake[]) {
  const { ctx } = c;
  const byId = new Map<string, Obstacle>(c.obstacles.map((o) => [o.id, o]));
  for (const [id, p] of piles) {
    const o = byId.get(id);
    const at = o && `${o.x},${o.y},${o.w}`;
    if (!o || at !== p.at) {
      // Moved or gone: the cap falls off as a burst of flakes.
      const [x, y, w] = p.at.split(",").map(Number);
      for (let k = 0; k < p.depth * 6; k++) flakes.push({ x: x + rand(0, w), y: y - rand(0, p.depth), r: rand(1, 2.5), vy: rand(60, 140), phase: rand(0, 6) });
      piles.delete(id);
      continue;
    }
    p.depth = Math.max(0, p.depth - 0.02 * c.dt); // slow melt
    const d = p.depth;
    if (d < 0.3) continue;
    ctx.fillStyle = "rgb(250 253 255 / 0.95)";
    ctx.shadowColor = "rgb(180 220 255 / 0.6)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(o.x + 6, o.y + 1);
    for (let x = 0; x <= o.w - 12; x += 12) ctx.quadraticCurveTo(o.x + 6 + x + 6, o.y - d - Math.sin(x * 0.37 + o.x) * 1.5, o.x + 6 + x + 12, o.y - d * 0.85);
    ctx.lineTo(o.x + o.w - 6, o.y + 1);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

type Petal = { x: number; y: number; vx: number; vy: number; rot: number; spin: number; size: number; color: string; on: Obstacle | null };

/** Petals or leaves: drift down, land on box tops, slide to the nearer edge and fall again. */
export function petals({ count = 46, colors = ["#ffc4dd", "#ffb0cf", "#ffd9e8", "#f9a8d4"], size = [5, 9] as [number, number] } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      const list: Petal[] = [];
      const spawn = (c: FxContext, top: boolean): Petal => ({
        x: rand(-40, c.w),
        y: top ? rand(-60, -10) : rand(0, c.h),
        vx: rand(10, 40),
        vy: rand(25, 55),
        rot: rand(0, 6.28),
        spin: rand(-2, 2),
        size: rand(size[0], size[1]),
        color: pick(colors),
        on: null,
      });
      return (c) => {
        const { ctx } = c;
        while (list.length < count) list.push(spawn(c, c.t > 0.5));
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          if (p.on) {
            // Sliding along the top of a box until it drops off an end.
            const still = c.obstacles.find((o) => o.id === p.on!.id);
            p.x += p.vx * c.dt;
            if (!still || p.x < still.x || p.x > still.x + still.w) p.on = null;
            else p.y = still.y - p.size * 0.3;
          } else {
            p.x += (p.vx + Math.sin(c.t + p.rot) * 20) * c.dt;
            p.y += p.vy * c.dt;
            p.rot += p.spin * c.dt;
            const hit = landingOn(c, p.x, p.y, 4);
            if (hit && Math.random() < 0.7) {
              p.on = hit;
              p.vx = (p.x - hit.x < hit.w / 2 ? -1 : 1) * rand(8, 22);
            }
          }
          if (p.y > c.floor + 10 || p.x > c.w + 40) {
            list[i] = spawn(c, true);
            continue;
          }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.on ? 0.2 : p.rot);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      };
    },
  };
}

export const leaves = () => petals({ count: 34, colors: ["#f59e0b", "#ea580c", "#b45309", "#facc15", "#dc2626"], size: [6, 11] });

/** Plain rain streaks across the whole screen. */
export function rain({ count = 220 } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      const drops = Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), v: rand(0.9, 1.4), l: rand(10, 22) }));
      return (c) => {
        const { ctx } = c;
        ctx.strokeStyle = "rgb(180 200 230 / 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const d of drops) {
          d.y += d.v * c.dt * 1.1;
          d.x -= 0.08 * c.dt;
          if (d.y > 1) {
            d.y = -0.05;
            d.x = Math.random() * 1.1;
          }
          const x = d.x * c.w;
          const y = d.y * c.h;
          ctx.moveTo(x, y);
          ctx.lineTo(x - d.l * 0.15, y + d.l);
        }
        ctx.stroke();
      };
    },
  };
}

/** Lofi rain: drops bead on the glass of each box, grow, then run down; now and then lightning. */
export function rainGlass(): FxDef {
  return {
    layer: "front",
    make: () => {
      type Drop = { box: string; fx: number; fy: number; r: number; run: number };
      const drops: Drop[] = [];
      let flash = 0;
      let nextFlash = rand(15, 40);
      return (c) => {
        const { ctx } = c;
        if (!c.obstacles.length) return;
        while (drops.length < c.obstacles.length * 22) {
          drops.push({ box: pick(c.obstacles).id, fx: Math.random(), fy: Math.random() * 0.8, r: rand(1.4, 3), run: 0 });
        }
        if (c.t > nextFlash) {
          flash = 1;
          nextFlash = c.t + rand(18, 45);
        }
        ctx.save();
        clipToObstacles(c);
        if (flash > 0) {
          ctx.fillStyle = `rgb(220 230 255 / ${0.18 * flash})`;
          ctx.fillRect(0, 0, c.w, c.h);
          flash = Math.max(0, flash - c.dt * 3);
        }
        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i];
          const o = c.obstacles.find((b) => b.id === d.box);
          if (!o) {
            drops.splice(i, 1);
            continue;
          }
          d.r += c.dt * 0.3;
          if (d.r > 4.2) d.run += c.dt * rand(0.15, 0.35);
          d.fy += d.run * c.dt;
          if (d.fy > 1.05) {
            drops.splice(i, 1);
            continue;
          }
          const x = o.x + d.fx * o.w;
          const y = o.y + 34 + d.fy * (o.h - 34);
          if (d.run > 0) {
            ctx.strokeStyle = "rgb(200 220 255 / 0.2)";
            ctx.lineWidth = d.r * 0.8;
            ctx.beginPath();
            ctx.moveTo(x, y - 30);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
          const g = ctx.createRadialGradient(x - d.r * 0.3, y - d.r * 0.3, 0, x, y, d.r);
          g.addColorStop(0, "rgb(255 255 255 / 0.8)");
          g.addColorStop(0.6, "rgb(190 210 245 / 0.3)");
          g.addColorStop(1, "rgb(150 170 220 / 0.2)");
          ctx.fillStyle = g;
          ctx.strokeStyle = "rgb(10 15 30 / 0.35)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(x, y, d.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      };
    },
  };
}

/** Fireflies wandering and pulsing. */
export function fireflies({ count = 26 } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      const flies = Array.from({ length: count }, () => ({ x: Math.random(), y: rand(0.3, 1), a: rand(0, 6.28), s: rand(0.01, 0.03), p: rand(0, 6.28) }));
      return (c) => {
        const { ctx } = c;
        for (const f of flies) {
          f.a += rand(-1.5, 1.5) * c.dt;
          f.x = (f.x + Math.cos(f.a) * f.s * c.dt + 1) % 1;
          f.y = Math.min(1, Math.max(0.15, f.y + Math.sin(f.a) * f.s * c.dt));
          const glow = 0.35 + 0.65 * Math.max(0, Math.sin(c.t * 1.7 + f.p));
          const x = f.x * c.w;
          const y = f.y * c.floor;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
          g.addColorStop(0, `rgb(255 250 170 / ${glow})`);
          g.addColorStop(0.3, `rgb(200 255 120 / ${glow * 0.5})`);
          g.addColorStop(1, "rgb(200 255 120 / 0)");
          ctx.fillStyle = g;
          ctx.fillRect(x - 9, y - 9, 18, 18);
        }
      };
    },
  };
}
