// Theme scenery standing on the desktop: a Christmas tree with gifts, pumpkins and a cauldron,
// potted apricot trees, the Mid-Autumn moon… Each group finds a spot clear of the boxes and
// widgets on this monitor (nearest to where it prefers to be) and moves when they move. It sits
// under the boxes and never takes the mouse. The SVGs animate themselves (lights, flames, steam).

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { loadAsset, type Asset } from "./assets";

export type SceneItem = {
  /** "<theme>/<file>" in src/decor. */
  art: string;
  /** Drawn width, px. */
  w: number;
  /** Shift from the end of the previous item (negative overlaps it, drawn in front). */
  dx?: number;
  /** Lift off the floor, px. */
  dy?: number;
};

export type SceneGroup = {
  /** Items laid out left to right, bottoms aligned. */
  items: readonly SceneItem[];
  /** floor: stands on the bottom edge of the desktop; sky: floats in its upper half. */
  at: "floor" | "sky";
  prefer: "left" | "center" | "right";
  /** PieDesk's home monitor, the other monitors, or every monitor. */
  on?: "home" | "other" | "all";
};

type Rect = { x: number; y: number; w: number; h: number };

const MARGIN = 10;
/** Desktop icons (the Recycle Bin…) live in the leftmost column; keep scenery off it. */
const ICON_COLUMN = 110;

export function DecorLayer({ groups, home, bounds, layoutKey }: { groups: readonly SceneGroup[]; home: boolean; bounds: { w: number; h: number }; layoutKey: unknown }) {
  const mine = useMemo(() => groups.filter((g) => (g.on ?? "all") === "all" || (g.on === "home") === home), [groups, home]);
  const assets = useAssets(mine);
  const [obstacles, setObstacles] = useState<Rect[]>([]);

  // Boxes and widgets as rendered (after clamping), re-measured when the layout settles.
  useLayoutEffect(() => {
    const measure = () =>
      setObstacles(
        [...document.querySelectorAll<HTMLElement>("[data-box-id], [data-widget-id]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    measure();
    const id = setTimeout(measure, 300);
    return () => clearTimeout(id);
  }, [layoutKey, bounds.w, bounds.h]);

  const placed = useMemo(() => {
    if (!assets) return [];
    const taken = [...obstacles];
    const out: { key: string; url: string; x: number; y: number; w: number; z: number }[] = [];
    mine.forEach((g, gi) => {
      // Art that is missing just leaves a gap-free group.
      const items = g.items.filter((it) => assets.has(it.art));
      if (!items.length) return;
      // The group's own layout, from its left edge.
      let x = 0;
      const parts = items.map((it, i) => {
        const a = assets.get(it.art)!;
        const h = (it.w * a.h) / a.w;
        const px = i === 0 ? 0 : x + (it.dx ?? 0);
        x = px + it.w;
        return { it, a, x: px, h: h + (it.dy ?? 0) };
      });
      const w = Math.max(...parts.map((p) => p.x + p.it.w));
      const h = Math.max(...parts.map((p) => p.h));
      const spot = findSpot(g, w, h, bounds, taken);
      taken.push({ ...spot, w, h });
      parts.forEach((p, i) =>
        out.push({ key: `${gi}-${i}`, url: p.a.url, x: spot.x + p.x, y: spot.y + h - p.h, w: p.it.w, z: i }),
      );
    });
    return out;
  }, [assets, mine, obstacles, bounds]);

  if (!placed.length) return null;
  return (
    <div className="pd-decor" aria-hidden>
      {placed.map((p) => (
        <img key={p.key} src={p.url} alt="" draggable={false} style={{ left: p.x, top: p.y, width: p.w, zIndex: p.z }} />
      ))}
    </div>
  );
}

/** The art of `groups` once every file has loaded or failed (missing ones are not in the map). */
function useAssets(groups: readonly SceneGroup[]) {
  const [map, setMap] = useState<Map<string, Asset> | null>(null);
  const keys = groups.flatMap((g) => g.items.map((i) => i.art)).join("|");
  useEffect(() => {
    let live = true;
    const list = keys ? keys.split("|") : [];
    void Promise.all(list.map(loadAsset)).then((all) => {
      if (!live) return;
      const m = new Map<string, Asset>();
      all.forEach((a, i) => a && m.set(list[i], a));
      setMap(m);
    });
    return () => void (live = false);
  }, [keys]);
  return map;
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w + MARGIN) - Math.max(a.x, b.x - MARGIN)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h + MARGIN) - Math.max(a.y, b.y - MARGIN));

/** The clear spot nearest to where the group prefers to be, or the least covered one. */
function findSpot(g: SceneGroup, w: number, h: number, bounds: { w: number; h: number }, taken: Rect[]): { x: number; y: number } {
  const minX = g.at === "floor" ? ICON_COLUMN : 24;
  const maxX = Math.max(minX, bounds.w - w - 16);
  const wantX = g.prefer === "left" ? minX : g.prefer === "right" ? maxX : (bounds.w - w) / 2;
  const ys = g.at === "floor" ? [bounds.h - h] : range(24, Math.max(24, bounds.h * 0.55 - h), 24);
  const wantY = ys[0];
  const candidates: { x: number; y: number; d: number }[] = [];
  for (const y of ys) for (const x of range(minX, maxX, 16)) candidates.push({ x, y, d: Math.abs(x - wantX) + Math.abs(y - wantY) * 1.5 });
  candidates.sort((a, b) => a.d - b.d);
  let best = candidates[0] ?? { x: wantX, y: wantY };
  let bestCover = Infinity;
  for (const c of candidates) {
    const r = { x: c.x, y: c.y, w, h };
    const cover = taken.reduce((s, t) => s + overlap(r, t), 0);
    if (cover === 0) return c;
    if (cover < bestCover) [best, bestCover] = [c, cover];
  }
  return best;
}

function range(a: number, b: number, step: number) {
  const out: number[] = [];
  for (let v = a; v <= b; v += step) out.push(v);
  if (!out.length || out[out.length - 1] !== b) out.push(b);
  return out;
}
