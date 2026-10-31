// Holiday effects: bats for Halloween, lanterns for Trung thu, fireworks for Tết.

import { pick, rand, type FxDef } from "./types";

/** Bats flapping across the screen on wavy paths. */
export function bats({ count = 7 } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      const list = Array.from({ length: count }, () => fresh(true));
      function fresh(anywhere = false) {
        const ltr = Math.random() < 0.5;
        return { x: anywhere ? Math.random() : ltr ? -0.05 : 1.05, y: rand(0.08, 0.6), v: rand(0.05, 0.11) * (ltr ? 1 : -1), s: rand(12, 22), p: rand(0, 6.28) };
      }
      return (c) => {
        const { ctx } = c;
        ctx.fillStyle = "rgb(28 10 36 / 0.95)";
        ctx.shadowColor = "rgb(255 122 24 / 0.75)";
        ctx.shadowBlur = 8;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          b.x += b.v * c.dt;
          if (b.x < -0.08 || b.x > 1.08) list[i] = fresh();
          const x = b.x * c.w;
          const y = b.y * c.h + Math.sin(c.t * 2 + b.p) * 30;
          const flap = Math.sin(c.t * 14 + b.p);
          const s = b.s;
          ctx.save();
          ctx.translate(x, y);
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 0.22, s * 0.32, 0, 0, Math.PI * 2);
          for (const side of [-1, 1]) {
            ctx.moveTo(0, -s * 0.1);
            ctx.quadraticCurveTo(side * s * 0.6, -s * (0.5 + flap * 0.5), side * s * 1.3, -s * flap * 0.4);
            ctx.quadraticCurveTo(side * s * 0.9, s * 0.05, side * s * 0.7, s * 0.25);
            ctx.quadraticCurveTo(side * s * 0.4, s * 0.05, 0, s * 0.2);
          }
          ctx.fill();
          ctx.restore();
        }
        ctx.shadowBlur = 0;
      };
    },
  };
}

/** Paper lanterns rising slowly, swaying and glowing. */
export function lanterns({ count = 12 } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      const list = Array.from({ length: count }, () => fresh(true));
      function fresh(anywhere = false) {
        return { x: Math.random(), y: anywhere ? rand(0.2, 1.1) : 1.1, v: rand(0.012, 0.03), s: rand(10, 18), p: rand(0, 6.28), hue: pick([0, 12, 28, 42]) };
      }
      return (c) => {
        const { ctx } = c;
        for (let i = 0; i < list.length; i++) {
          const l = list[i];
          l.y -= l.v * c.dt;
          if (l.y < -0.1) list[i] = fresh();
          const x = l.x * c.w + Math.sin(c.t * 0.7 + l.p) * 16;
          const y = l.y * c.floor;
          const s = l.s;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 2.4);
          glow.addColorStop(0, `hsl(${l.hue} 100% 65% / 0.45)`);
          glow.addColorStop(1, `hsl(${l.hue} 100% 60% / 0)`);
          ctx.fillStyle = glow;
          ctx.fillRect(x - s * 2.4, y - s * 2.4, s * 4.8, s * 4.8);
          ctx.fillStyle = `hsl(${l.hue} 90% 52%)`;
          ctx.beginPath();
          ctx.ellipse(x, y, s * 0.7, s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgb(250 204 21 / 0.9)";
          ctx.fillRect(x - s * 0.45, y - s - 2, s * 0.9, 3);
          ctx.fillRect(x - s * 0.45, y + s - 1, s * 0.9, 3);
          ctx.strokeStyle = "rgb(250 204 21 / 0.8)";
          ctx.beginPath();
          ctx.moveTo(x, y + s + 2);
          ctx.lineTo(x, y + s + 9);
          ctx.stroke();
        }
      };
    },
  };
}

/** A firework every few seconds: a rocket climbs, bursts, sparks fall and fade. */
export function fireworks(): FxDef {
  return {
    layer: "front",
    make: () => {
      type Spark = { x: number; y: number; vx: number; vy: number; life: number; hue: number };
      let rocket: { x: number; y: number; top: number; hue: number } | null = null;
      const sparks: Spark[] = [];
      let next = 1.5;
      return (c) => {
        const { ctx } = c;
        if (!rocket && c.t > next) {
          rocket = { x: rand(0.1, 0.9) * c.w, y: c.floor, top: rand(0.12, 0.4) * c.h, hue: pick([0, 45, 50, 330, 200]) };
          next = c.t + rand(2.5, 5);
        }
        if (rocket) {
          rocket.y -= 520 * c.dt;
          ctx.fillStyle = `hsl(${rocket.hue} 100% 75%)`;
          ctx.fillRect(rocket.x - 1, rocket.y, 2, 8);
          if (rocket.y <= rocket.top) {
            for (let k = 0; k < 70; k++) {
              const a = (k / 70) * Math.PI * 2;
              const v = rand(70, 190);
              sparks.push({ x: rocket.x, y: rocket.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, hue: rocket.hue + rand(-15, 15) });
            }
            rocket = null;
          }
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.vy += 90 * c.dt;
          s.vx *= 1 - 0.9 * c.dt;
          s.x += s.vx * c.dt;
          s.y += s.vy * c.dt;
          s.life -= c.dt * 0.7;
          if (s.life <= 0) {
            sparks.splice(i, 1);
            continue;
          }
          ctx.fillStyle = `hsl(${s.hue} 100% 65% / ${s.life})`;
          ctx.fillRect(s.x, s.y, 2.2, 2.2);
        }
      };
    },
  };
}
