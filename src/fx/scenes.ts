// Scenes drawn inside the boxes, behind their glass: digital rain, a synthwave horizon, a
// starfield that follows the pointer, and an aquarium.

import { clipToObstacles, pick, rand, type FxDef } from "./types";

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEFZ:+-*<>".split("");

/** Matrix rain inside every box. Trails fade by erasing a little of the canvas each frame. */
export function matrix(): FxDef {
  return {
    layer: "back",
    trails: true,
    make: () => {
      const size = 14;
      let drops: number[] = [];
      return (c) => {
        const { ctx } = c;
        const cols = Math.ceil(c.w / size);
        if (drops.length !== cols) drops = Array.from({ length: cols }, () => rand(-40, 0));
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = `rgb(0 0 0 / ${Math.min(1, 3.2 * c.dt)})`;
        ctx.fillRect(0, 0, c.w, c.h);
        ctx.restore();
        ctx.save();
        clipToObstacles(c, 6);
        ctx.font = `${size}px Consolas, monospace`;
        for (let i = 0; i < cols; i++) {
          const y = drops[i] * size;
          ctx.fillStyle = "rgb(190 255 210 / 0.95)";
          ctx.fillText(pick(GLYPHS), i * size, y);
          ctx.fillStyle = "rgb(0 255 102 / 0.55)";
          ctx.fillText(pick(GLYPHS), i * size, y - size);
          drops[i] += c.dt * 14;
          if (y > c.h && Math.random() > 0.97) drops[i] = rand(-20, 0);
        }
        ctx.restore();
      };
    },
  };
}

/** Synthwave: a striped sun and a scrolling neon grid in the lower half of each box. */
export function synthGrid(): FxDef {
  return {
    layer: "back",
    make: () => (c) => {
      const { ctx } = c;
      for (const o of c.obstacles) {
        if (o.h < 90) continue;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(o.x, o.y, o.w, o.h, 14);
        ctx.clip();
        const horizon = o.y + o.h * 0.58;
        const cx = o.x + o.w / 2;
        const r = Math.min(o.w, o.h) * 0.22;
        const sun = ctx.createLinearGradient(0, horizon - r, 0, horizon);
        sun.addColorStop(0, "rgb(255 220 90 / 0.55)");
        sun.addColorStop(1, "rgb(255 56 200 / 0.5)");
        ctx.fillStyle = sun;
        ctx.beginPath();
        ctx.arc(cx, horizon, r, Math.PI, 0);
        ctx.fill();
        ctx.globalCompositeOperation = "destination-out";
        for (let k = 1; k <= 4; k++) ctx.fillRect(cx - r, horizon - k * r * 0.2, r * 2, k * 1.5);
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgb(255 56 200 / 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const depth = o.y + o.h - horizon;
        const scroll = (c.t * 0.35) % 1;
        for (let k = 0; k < 9; k++) {
          const z = (k + scroll) / 9;
          const y = horizon + depth * z * z;
          ctx.moveTo(o.x, y);
          ctx.lineTo(o.x + o.w, y);
        }
        for (let k = -8; k <= 8; k++) {
          ctx.moveTo(cx + k * 6, horizon);
          ctx.lineTo(cx + k * o.w * 0.16, o.y + o.h);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}

/** Starfield inside the boxes: twinkles, shifts with the pointer by depth, shooting stars. */
export function stars(): FxDef {
  return {
    layer: "back",
    make: () => {
      let field: { x: number; y: number; z: number; p: number }[] = [];
      let shot: { x: number; y: number; life: number } | null = null;
      let ox = 0;
      let oy = 0;
      return (c) => {
        const { ctx } = c;
        if (!field.length) field = Array.from({ length: Math.round((c.w * c.h) / 6000) }, () => ({ x: Math.random() * c.w, y: Math.random() * c.h, z: rand(0.2, 1), p: rand(0, 6.28) }));
        const tx = c.pointer ? (c.pointer.x - c.w / 2) / c.w : 0;
        const ty = c.pointer ? (c.pointer.y - c.h / 2) / c.h : 0;
        ox += (tx - ox) * Math.min(1, c.dt * 3);
        oy += (ty - oy) * Math.min(1, c.dt * 3);
        ctx.save();
        clipToObstacles(c, 18);
        for (const s of field) {
          const a = 0.35 + 0.65 * Math.abs(Math.sin(c.t * (0.6 + s.z) + s.p));
          ctx.fillStyle = `rgb(230 225 255 / ${a * s.z})`;
          ctx.fillRect(s.x - ox * 40 * s.z, s.y - oy * 40 * s.z, s.z * 1.8, s.z * 1.8);
        }
        if (!shot && Math.random() < c.dt * 0.08) shot = { x: rand(0, c.w), y: rand(0, c.h * 0.6), life: 1 };
        if (shot) {
          const g = ctx.createLinearGradient(shot.x, shot.y, shot.x - 90, shot.y - 30);
          g.addColorStop(0, `rgb(255 255 255 / ${shot.life})`);
          g.addColorStop(1, "rgb(255 255 255 / 0)");
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(shot.x, shot.y);
          ctx.lineTo(shot.x - 90, shot.y - 30);
          ctx.stroke();
          shot.x += 520 * c.dt;
          shot.y += 170 * c.dt;
          shot.life -= c.dt * 1.4;
          if (shot.life <= 0) shot = null;
        }
        ctx.restore();
      };
    },
  };
}

/** Aquarium: bubbles rising inside the boxes, fish swimming between them. */
export function aquarium(): FxDef {
  return {
    layer: "back",
    make: () => {
      const bubbles: { x: number; y: number; r: number; v: number }[] = [];
      const fish = Array.from({ length: 6 }, (_, i) => ({
        x: Math.random(),
        y: rand(0.15, 0.85),
        v: rand(0.02, 0.05) * (i % 2 ? 1 : -1),
        s: rand(10, 18),
        hue: pick([18, 40, 190, 330, 50]),
        p: rand(0, 6.28),
      }));
      return (c) => {
        const { ctx } = c;
        for (const f of fish) {
          f.x += f.v * c.dt;
          if (f.x > 1.08) f.x = -0.08;
          if (f.x < -0.08) f.x = 1.08;
          const x = f.x * c.w;
          const y = f.y * c.h + Math.sin(c.t * 0.8 + f.p) * 14;
          const dir = Math.sign(f.v);
          const wag = Math.sin(c.t * 8 + f.p) * 0.3;
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(dir, 1);
          ctx.fillStyle = `hsl(${f.hue} 90% 60% / 0.75)`;
          ctx.beginPath();
          ctx.ellipse(0, 0, f.s, f.s * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-f.s * 0.8, 0);
          ctx.lineTo(-f.s * 1.5, -f.s * (0.45 + wag));
          ctx.lineTo(-f.s * 1.5, f.s * (0.45 - wag));
          ctx.fill();
          ctx.fillStyle = "rgb(0 0 0 / 0.6)";
          ctx.beginPath();
          ctx.arc(f.s * 0.5, -f.s * 0.1, 1.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        if (c.obstacles.length && bubbles.length < c.obstacles.length * 10 && Math.random() < 0.3) {
          const o = pick(c.obstacles);
          bubbles.push({ x: o.x + rand(10, o.w - 10), y: o.y + o.h, r: rand(1.5, 4.5), v: rand(25, 55) });
        }
        ctx.save();
        clipToObstacles(c, 22);
        ctx.strokeStyle = "rgb(200 250 255 / 0.55)";
        ctx.lineWidth = 1;
        for (let i = bubbles.length - 1; i >= 0; i--) {
          const b = bubbles[i];
          b.y -= b.v * c.dt;
          b.x += Math.sin(c.t * 3 + b.r) * 0.3;
          if (b.y < -10 || !c.obstacles.some((o) => b.x >= o.x && b.x <= o.x + o.w && b.y >= o.y - 10)) {
            bubbles.splice(i, 1);
            continue;
          }
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      };
    },
  };
}
