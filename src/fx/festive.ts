// Holiday effects, most of them drawn with the SVG art in src/decor (each falls back to plain
// shapes until its art has loaded): bats, a witch, ghosts, spiders and fog for Halloween; Santa's
// sleigh for Christmas; fireworks for Tết; sky lanterns and clouds for Trung thu.

import { drawSprite, sprite } from "../decor/assets";
import { lunarToSolar } from "../lib/lunar";
import { pick, rand, type FxContext, type FxDef } from "./types";

// ---------------------------------------------------------------------------------------------
// Halloween

/** One bat at (x, y), `s` px wide, flapping at phase `flap`, facing right unless `left`. */
function drawBat(c: FxContext, x: number, y: number, s: number, flap: number, left: boolean) {
  const { ctx } = c;
  const frame = sprite(Math.sin(flap) > 0 ? "halloween/bat-a" : "halloween/bat-b", 64, left);
  if (frame) {
    drawSprite(ctx, frame, x, y, s, 0.5, 0.5);
    return;
  }
  const f = Math.sin(flap);
  const h = s / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgb(28 10 36 / 0.95)";
  ctx.beginPath();
  ctx.ellipse(0, 0, h * 0.22, h * 0.32, 0, 0, Math.PI * 2);
  for (const side of [-1, 1]) {
    ctx.moveTo(0, -h * 0.1);
    ctx.quadraticCurveTo(side * h * 0.6, -h * (0.5 + f * 0.5), side * h * 1.3, -h * f * 0.4);
    ctx.quadraticCurveTo(side * h * 0.9, h * 0.05, side * h * 0.7, h * 0.25);
    ctx.quadraticCurveTo(side * h * 0.4, h * 0.05, 0, h * 0.2);
  }
  ctx.fill();
  ctx.restore();
}

/** A few bats flapping across the screen on wavy paths. */
export function bats({ count = 6 } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      const list = Array.from({ length: count }, () => fresh(true));
      function fresh(anywhere = false) {
        const ltr = Math.random() < 0.5;
        return { x: anywhere ? Math.random() : ltr ? -0.05 : 1.05, y: rand(0.08, 0.6), v: rand(0.05, 0.11) * (ltr ? 1 : -1), s: rand(22, 40), p: rand(0, 6.28) };
      }
      return (c) => {
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          b.x += b.v * c.dt;
          if (b.x < -0.08 || b.x > 1.08) list[i] = fresh();
          drawBat(c, b.x * c.w, b.y * c.h + Math.sin(c.t * 2 + b.p) * 30, b.s, c.t * 14 + b.p, b.v < 0);
        }
      };
    },
  };
}

/** Now and then a swarm of bats bursts out of a bottom corner and scatters across the screen. */
export function batSwarm({ every = [50, 120] as [number, number], first = [8, 25] as [number, number] } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      type Bat = { x: number; y: number; vx: number; vy: number; s: number; p: number; born: number };
      const list: Bat[] = [];
      let next = rand(...first);
      return (c) => {
        if (c.t > next) {
          next = c.t + rand(...every);
          const fromLeft = Math.random() < 0.5;
          const n = Math.round(rand(22, 34));
          for (let i = 0; i < n; i++) {
            const a = rand(0.35, 1.05); // radians above the horizontal
            const v = rand(170, 320);
            list.push({
              x: fromLeft ? rand(-60, 40) : c.w + rand(-40, 60),
              y: c.floor - rand(0, 80),
              vx: Math.cos(a) * v * (fromLeft ? 1 : -1),
              vy: -Math.sin(a) * v,
              s: rand(16, 46),
              p: rand(0, 6.28),
              born: c.t + rand(0, 2.6),
            });
          }
        }
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i];
          if (c.t < b.born) continue;
          b.x += b.vx * c.dt;
          b.y += (b.vy + Math.sin(c.t * 5 + b.p) * 40) * c.dt;
          b.vy += 18 * c.dt; // level out a little
          if (b.y < -60 || b.x < -80 || b.x > c.w + 80) {
            list.splice(i, 1);
            continue;
          }
          drawBat(c, b.x, b.y, b.s, c.t * 16 + b.p, b.vx < 0);
        }
      };
    },
  };
}

type FlyOpts = {
  asset: string;
  w: number;
  every: [number, number];
  first: [number, number];
  /** Seconds to cross the screen. */
  dur: [number, number];
  /** Height band, as fractions of the screen. */
  y: [number, number];
  /** The art faces right; `both` also flies right-to-left, mirrored. */
  both?: boolean;
  trail?: (c: FxContext, x: number, y: number, dir: number) => void;
};

/** Something crossing the sky now and then on a gentle arc. */
function flyBy(o: FlyOpts): FxDef {
  return {
    layer: "front",
    make: () => {
      let next = rand(...o.first);
      let run: { t0: number; dur: number; y: number; dir: number } | null = null;
      return (c) => {
        if (!run && c.t > next) {
          run = { t0: c.t, dur: rand(...o.dur), y: rand(...o.y), dir: o.both && Math.random() < 0.5 ? -1 : 1 };
          next = c.t + rand(...o.every);
        }
        if (!run) return;
        const p = (c.t - run.t0) / run.dur;
        if (p > 1) {
          run = null;
          return;
        }
        const span = c.w + o.w * 2;
        const x = run.dir > 0 ? -o.w + p * span : c.w + o.w - p * span;
        const y = run.y * c.h - Math.sin(p * Math.PI) * c.h * 0.06 + Math.sin(c.t * 3) * 4;
        o.trail?.(c, x - (run.dir * o.w) / 2, y + 6, run.dir);
        const s = sprite(o.asset, o.w, run.dir < 0);
        if (s) drawSprite(c.ctx, s, x, y, o.w, 0.5, 0.5);
      };
    },
  };
}

/** Sparkles that fall and fade, left behind by something flying. */
function sparkleTrail(colors: string[]) {
  const dots: { x: number; y: number; vy: number; life: number; color: string }[] = [];
  return (c: FxContext, x: number, y: number) => {
    if (Math.random() < 0.8) dots.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), vy: rand(10, 40), life: 1, color: pick(colors) });
    const { ctx } = c;
    for (let i = dots.length - 1; i >= 0; i--) {
      const d = dots[i];
      d.y += d.vy * c.dt;
      d.life -= c.dt * 0.6;
      if (d.life <= 0) {
        dots.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = d.life * (0.6 + 0.4 * Math.sin(c.t * 20 + d.x));
      ctx.fillStyle = d.color;
      ctx.fillRect(d.x - 1, d.y - 1, 2.2, 2.2);
    }
    ctx.globalAlpha = 1;
  };
}

export const witch = () =>
  flyBy({ asset: "halloween/witch", w: 130, every: [120, 260], first: [35, 80], dur: [11, 15], y: [0.1, 0.3], both: true, trail: sparkleTrail(["#a855f7", "#a3e635", "#f0abfc"]) });

/** A ghost rises from the lower half now and then, drifting and fading in and out. */
export function ghosts(): FxDef {
  return {
    layer: "front",
    make: () => {
      let next = rand(10, 25);
      let g: { x: number; y: number; t0: number; life: number; p: number; dir: number } | null = null;
      return (c) => {
        if (!g && c.t > next) {
          g = { x: rand(0.1, 0.9) * c.w, y: c.floor - rand(40, 160), t0: c.t, life: rand(10, 14), p: rand(0, 6.28), dir: Math.random() < 0.5 ? -1 : 1 };
          next = c.t + g.life + rand(25, 60);
        }
        if (!g) return;
        const age = c.t - g.t0;
        if (age > g.life) {
          g = null;
          return;
        }
        g.y -= 16 * c.dt;
        g.x += (g.dir * 14 + Math.sin(c.t * 0.9 + g.p) * 22) * c.dt;
        const s = sprite("halloween/ghost", 54, g.dir < 0);
        if (!s) return;
        c.ctx.globalAlpha = 0.75 * Math.min(1, age / 1.5, (g.life - age) / 2);
        drawSprite(c.ctx, s, g.x, g.y + Math.sin(c.t * 2 + g.p) * 6, 54, 0.5, 0.5);
        c.ctx.globalAlpha = 1;
      };
    },
  };
}

/** A spider lowers itself from the top of the screen on its thread, waits, and climbs back. */
export function spiderDrop({ every = [70, 160] as [number, number] } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      let next = rand(20, 50);
      let s: { x: number; depth: number; t0: number; p: number } | null = null;
      return (c) => {
        if (!s && c.t > next) {
          s = { x: rand(0.08, 0.92) * c.w, depth: rand(90, 230), t0: c.t, p: rand(0, 6.28) };
          next = c.t + 13 + rand(...every);
        }
        if (!s) return;
        const age = c.t - s.t0;
        const ease = (x: number) => x * x * (3 - 2 * x);
        const k = age < 3.5 ? ease(age / 3.5) : age < 9.5 ? 1 : age < 12.5 ? 1 - ease((age - 9.5) / 3) : -1;
        if (k < 0) {
          s = null;
          return;
        }
        const y = s.depth * k + (k === 1 ? Math.sin(c.t * 1.6 + s.p) * 4 : 0);
        const x = s.x + Math.sin(c.t * 0.8 + s.p) * 3 * k;
        const { ctx } = c;
        ctx.strokeStyle = "rgb(233 227 245 / 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x, 0);
        ctx.lineTo(x, y);
        ctx.stroke();
        const art = sprite("halloween/spider", 30);
        if (art) drawSprite(ctx, art, x, y - 2, 30);
      };
    },
  };
}

/** Purple-green mist drifting along the bottom of the desktop. */
export function fog(): FxDef {
  return {
    layer: "back",
    make: () => {
      const blobs = Array.from({ length: 9 }, (_, i) => ({ x: (i + rand(0, 0.8)) / 9, dy: rand(0, 70), r: rand(150, 260), v: rand(-10, 10), p: rand(0, 6.28), green: Math.random() < 0.3 }));
      return (c) => {
        const { ctx } = c;
        for (const b of blobs) {
          b.x += (b.v / c.w) * c.dt;
          if (b.x < -0.2) b.x = 1.2;
          if (b.x > 1.2) b.x = -0.2;
          const x = b.x * c.w;
          const y = c.floor - b.dy + Math.sin(c.t * 0.3 + b.p) * 10;
          const a = 0.13 + 0.05 * Math.sin(c.t * 0.5 + b.p);
          const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
          g.addColorStop(0, b.green ? `rgb(120 200 120 / ${a})` : `rgb(160 110 230 / ${a})`);
          g.addColorStop(1, "rgb(120 80 200 / 0)");
          ctx.fillStyle = g;
          ctx.fillRect(x - b.r, y - b.r, b.r * 2, b.r * 2);
        }
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Christmas

export const sleigh = () =>
  flyBy({ asset: "christmas/sleigh", w: 230, every: [100, 200], first: [12, 35], dur: [14, 18], y: [0.08, 0.22], trail: sparkleTrail(["#fde68a", "#facc15", "#ffffff"]) });

// ---------------------------------------------------------------------------------------------
// Tết

type Burst = "peony" | "ring" | "willow" | "palm" | "glitter" | "multi";
const BURSTS: Burst[] = ["peony", "peony", "ring", "willow", "palm", "glitter", "multi", "multi"];
const HUES = [0, 30, 45, 55, 120, 190, 220, 280, 320, 340];

/** Whether `now` is the first minutes of Tết (giao thừa), when the sky really lights up. */
function newYearsMidnight(now = new Date()) {
  const d = lunarToSolar(1, 1, now.getFullYear());
  return !!d && now.getDate() === d[0] && now.getMonth() + 1 === d[1] && now.getHours() === 0 && now.getMinutes() < 15;
}

type FireworksOpts = {
  /** Seconds between launches. */
  every?: [number, number];
  /** Chance that a launch is a volley of several rockets. */
  volley?: number;
  /** A big show for the first minutes of the lunar new year. */
  midnight?: boolean;
};

/** Fireworks of several kinds (peony, ring, gold willow, palm, glitter, many-coloured). */
export function fireworks({ every = [1.8, 4.5], volley = 0.15, midnight = false }: FireworksOpts = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      type Spark = { x: number; y: number; vx: number; vy: number; life: number; decay: number; hue: number; light: number; size: number; trail: number; drag: number; grav: number; twinkle: boolean };
      type Rocket = { x: number; y: number; vx: number; top: number; burst: Burst; hue: number; delay: number };
      const rockets: Rocket[] = [];
      const sparks: Spark[] = [];
      let next = rand(1, 3);
      let show = false;
      let checkedAt = -60;
      const launch = (c: FxContext, delay = 0) =>
        rockets.push({ x: rand(0.1, 0.9) * c.w, y: c.floor, vx: rand(-25, 25), top: rand(0.1, 0.42) * c.h, burst: pick(BURSTS), hue: pick(HUES), delay });
      const spark = (r: Rocket, angle: number, speed: number, o: Partial<Spark> = {}) =>
        sparks.push({ x: r.x, y: r.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, decay: rand(0.55, 0.8), hue: r.hue + rand(-12, 12), light: 62, size: 2, trail: 0.05, drag: 1.1, grav: 70, twinkle: false, ...o });
      const explode = (r: Rocket) => {
        const n = sparks.length > 1400 ? 30 : 1;
        switch (r.burst) {
          case "peony":
          case "multi":
            for (let k = 0; k < 90 / n; k++) spark(r, rand(0, 6.28), rand(60, 210), r.burst === "multi" ? { hue: pick(HUES) } : {});
            break;
          case "ring": {
            const tilt = rand(0.45, 0.8);
            for (let k = 0; k < 56 / n; k++) {
              const a = (k / 56) * Math.PI * 2;
              sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170 * tilt, life: 1, decay: 0.7, hue: r.hue, light: 65, size: 2.2, trail: 0.05, drag: 1.2, grav: 50, twinkle: false });
            }
            spark(r, 0, 0, { size: 5, decay: 2.5, light: 85 });
            break;
          }
          case "willow":
            for (let k = 0; k < 80 / n; k++) spark(r, rand(0, 6.28), rand(50, 150), { hue: rand(38, 48), light: 60, decay: rand(0.28, 0.4), trail: 0.16, drag: 1.8, grav: 55, size: 1.6 });
            break;
          case "palm":
            for (let k = 0; k < 9; k++) {
              const a = -Math.PI / 2 + ((k - 4) / 4) * 1.4;
              for (let j = 0; j < 6; j++) spark(r, a + rand(-0.06, 0.06), 160 + j * 14, { size: 2.6 - j * 0.25, decay: 0.45, trail: 0.12, grav: 90 });
            }
            break;
          case "glitter":
            for (let k = 0; k < 110 / n; k++) spark(r, rand(0, 6.28), rand(40, 190), { hue: pick([45, 50, 0]), light: 75, twinkle: true, decay: rand(0.4, 0.6), size: 1.8 });
            break;
        }
      };
      return (c) => {
        const { ctx, dt } = c;
        if (midnight && c.t - checkedAt > 30) {
          checkedAt = c.t;
          show = newYearsMidnight();
        }
        if (c.t > next) {
          const shots = show ? Math.round(rand(2, 5)) : Math.random() < volley ? Math.round(rand(3, 6)) : 1;
          for (let i = 0; i < shots; i++) launch(c, i * rand(0.15, 0.5));
          next = c.t + (show ? rand(0.5, 1.4) : rand(...every));
        }
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i];
          if (r.delay > 0) {
            r.delay -= dt;
            continue;
          }
          r.y -= 480 * dt;
          r.x += r.vx * dt;
          ctx.strokeStyle = `hsl(${r.hue} 100% 80%)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x - r.vx * 0.03, r.y + 14);
          ctx.stroke();
          if (Math.random() < 0.6) sparks.push({ x: r.x, y: r.y + 10, vx: rand(-15, 15), vy: rand(20, 60), life: 0.6, decay: 1.6, hue: 40, light: 70, size: 1.4, trail: 0.02, drag: 1, grav: 40, twinkle: false });
          if (r.y <= r.top) {
            explode(r);
            rockets.splice(i, 1);
          }
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.vy += s.grav * dt;
          s.vx *= 1 - s.drag * dt;
          s.vy *= 1 - s.drag * dt * 0.5;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.life -= dt * s.decay;
          if (s.life <= 0 || s.y > c.h) {
            sparks.splice(i, 1);
            continue;
          }
          const a = s.twinkle && s.life < 0.6 ? s.life * (Math.random() < 0.5 ? 0.2 : 1.4) : s.life;
          ctx.strokeStyle = `hsl(${s.hue} 100% ${s.light}% / ${Math.min(1, a)})`;
          ctx.lineWidth = s.size;
          ctx.beginPath();
          ctx.moveTo(s.x - s.vx * s.trail, s.y - s.vy * s.trail);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }
        ctx.restore();
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Trung thu

/** Sky lanterns (đèn Khổng Minh) rising slowly, swaying, their flames flickering. */
export function lanterns({ count = 12 } = {}): FxDef {
  return {
    layer: "front",
    make: () => {
      const list = Array.from({ length: count }, () => fresh(true));
      function fresh(anywhere = false) {
        const s = rand(14, 34); // nearer ones are bigger and rise faster
        return { x: Math.random(), y: anywhere ? rand(0.2, 1.1) : 1.1, v: 0.006 + s * 0.0009, s, p: rand(0, 6.28), hue: pick([18, 28, 36, 42]) };
      }
      return (c) => {
        const { ctx } = c;
        for (let i = 0; i < list.length; i++) {
          const l = list[i];
          l.y -= l.v * c.dt;
          if (l.y < -0.1) list[i] = fresh();
          const x = l.x * c.w + Math.sin(c.t * 0.6 + l.p) * 14;
          const y = l.y * c.floor;
          const s = l.s;
          const flicker = 0.8 + 0.2 * Math.sin(c.t * 9 + l.p) * Math.sin(c.t * 5.3 + l.p * 2);
          const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 2.2);
          glow.addColorStop(0, `hsl(${l.hue} 100% 62% / ${0.42 * flicker})`);
          glow.addColorStop(1, `hsl(${l.hue} 100% 55% / 0)`);
          ctx.fillStyle = glow;
          ctx.fillRect(x - s * 2.2, y - s * 2.2, s * 4.4, s * 4.4);
          const art = sprite("midautumn/khong-minh", 40);
          ctx.globalAlpha = 0.75 + 0.25 * flicker;
          if (art) drawSprite(ctx, art, x, y, s, 0.5, 0.5);
          else {
            ctx.fillStyle = `hsl(${l.hue} 90% 55%)`;
            ctx.beginPath();
            ctx.moveTo(x - s * 0.4, y - s * 0.6);
            ctx.lineTo(x + s * 0.4, y - s * 0.6);
            ctx.lineTo(x + s * 0.3, y + s * 0.6);
            ctx.lineTo(x - s * 0.3, y + s * 0.6);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      };
    },
  };
}

/** Auspicious clouds drifting slowly across the upper sky. */
export function clouds(): FxDef {
  return {
    layer: "back",
    make: () => {
      const list = Array.from({ length: 4 }, () => ({ x: Math.random(), y: rand(0.04, 0.35), w: rand(150, 260), v: rand(5, 12), a: rand(0.22, 0.4) }));
      return (c) => {
        for (const cl of list) {
          cl.x += (cl.v / c.w) * c.dt;
          if (cl.x > 1.15) Object.assign(cl, { x: -0.15, y: rand(0.04, 0.35) });
          const s = sprite("midautumn/cloud", cl.w);
          if (!s) continue;
          c.ctx.globalAlpha = cl.a;
          drawSprite(c.ctx, s, cl.x * c.w, cl.y * c.h, cl.w, 0.5, 0.5);
        }
        c.ctx.globalAlpha = 1;
      };
    },
  };
}
