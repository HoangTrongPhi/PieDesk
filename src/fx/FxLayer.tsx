// Runs canvas effects (src/fx) at up to 30 fps. Stops drawing while a fullscreen app runs, while on
// battery (setting `fxBattery`), when the OS asks for reduced motion, or when `enabled` is off;
// the simulations keep their state, so snow piles survive a pause.

import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { settingsWithDefaults, useDoc } from "../stores/doc";
import { FX, type FxId } from ".";
import type { FxContext, FxDef, Obstacle, Sim } from "./types";

const FPS = 30;

const useGate = create<{ fullscreen: boolean; battery: boolean; reduced: boolean }>(() => ({
  fullscreen: false,
  battery: false,
  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
}));

let gateStarted = false;
function startGate() {
  if (gateStarted) return;
  gateStarted = true;
  void listen<boolean>("guard://paused", ({ payload }) => useGate.setState({ fullscreen: payload }));
  void listen<boolean>("power://battery", ({ payload }) => useGate.setState({ battery: payload }));
  invoke<boolean>("power_on_battery").then((battery) => useGate.setState({ battery })).catch(() => {});
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => useGate.setState({ reduced: e.matches }));
}

/** Whether effects may run right now. */
export function useFxAllowed(enabled: boolean) {
  const fxBattery = settingsWithDefaults(useDoc((s) => s.settings)).fxBattery;
  const { fullscreen, battery, reduced } = useGate();
  useEffect(startGate, []);
  return enabled && !fullscreen && !reduced && !(battery && fxBattery);
}

// Boxes and widgets on screen, re-measured at most 4× a second.
let obstacles: Obstacle[] = [];
let measuredAt = 0;
function sampleObstacles(now: number): Obstacle[] {
  if (now - measuredAt < 250) return obstacles;
  measuredAt = now;
  obstacles = [...document.querySelectorAll<HTMLElement>("[data-box-id], [data-widget-id]")]
    .filter((el) => !el.classList.contains("pd-widget-bare"))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.boxId ?? el.dataset.widgetId ?? "", x: r.x, y: r.y, w: r.width, h: r.height };
    });
  return obstacles;
}

let pointer: { x: number; y: number } | null = null;
addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }), { passive: true });

type Props = {
  ids: FxId[];
  enabled: boolean;
  /** Effects react to boxes on this page (false in the overlay window). */
  withBoxes?: boolean;
  /** Ground line in CSS px (default: bottom of the window). */
  floor?: number;
};

export function FxLayer({ ids, enabled, withBoxes = true, floor }: Props) {
  const allowed = useFxAllowed(enabled);
  const key = ids.join(",");
  const defs = useMemo(() => ids.map((id) => FX[id]()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!defs.length) return null;
  const back = defs.filter((d) => d.layer === "back");
  const front = defs.filter((d) => d.layer === "front");
  return (
    <>
      {back.length > 0 && <Layer key={`b${key}`} defs={back} className="pd-fx pd-fx-back" run={allowed} withBoxes={withBoxes} floor={floor} />}
      {front.length > 0 && <Layer key={`f${key}`} defs={front} className="pd-fx pd-fx-front" run={allowed} withBoxes={withBoxes} floor={floor} />}
    </>
  );
}

function Layer({ defs, className, run, withBoxes, floor }: { defs: FxDef[]; className: string; run: boolean; withBoxes: boolean; floor?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sims = useMemo<Sim[]>(() => defs.map((d) => d.make()), [defs]);
  const started = useRef(performance.now());

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let w = 0;
    let h = 0;
    const size = () => {
      const dpr = devicePixelRatio || 1;
      w = innerWidth;
      h = innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    if (!run) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    addEventListener("resize", size);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS - 2) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Front layers redraw from scratch; back layers may keep trails (matrix) and clear themselves.
      if (className.includes("front")) ctx.clearRect(0, 0, w, h);
      const c: FxContext = {
        ctx,
        w,
        h,
        t: (now - started.current) / 1000,
        dt,
        obstacles: withBoxes ? sampleObstacles(now) : [],
        pointer,
        floor: floor ?? h,
      };
      for (const sim of sims) sim(c);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", size);
    };
  }, [sims, run, className, withBoxes, floor]);

  return <canvas ref={ref} className={className} />;
}
