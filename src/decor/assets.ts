// Decor art: hand-drawn SVGs in src/decor/<theme>/<name>.svg, addressed as "<theme>/<name>".
// Each file is its own lazy chunk, so a window only loads the art of the theme it shows.
// DOM scenery uses the data URL (the SVG's own CSS animations play there); canvas effects use
// `sprite`, a bitmap rasterised once per size.

import { useEffect, useState } from "react";

export type Asset = { key: string; url: string; img: HTMLImageElement; w: number; h: number };

const loaders = import.meta.glob<string>("./*/*.svg", { query: "?raw", import: "default" });
const loading = new Map<string, Promise<Asset | null>>();
const loaded = new Map<string, Asset | null>();

export function loadAsset(key: string): Promise<Asset | null> {
  let p = loading.get(key);
  if (!p) {
    const load = loaders[`./${key}.svg`];
    p = (load ? load() : Promise.resolve(null))
      .then(async (svg) => {
        if (!svg) return null;
        const [, , w, h] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 100 100").split(/[\s,]+/).map(Number);
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        const img = new Image();
        img.src = url;
        // decode() is refused in a hidden window (overlays start hidden); load still works there.
        await img.decode().catch(
          () => new Promise<void>((ok, fail) => (img.complete && img.naturalWidth ? ok() : ((img.onload = () => ok()), (img.onerror = fail)))),
        );
        return { key, url, img, w: w || 100, h: h || 100 };
      })
      .then(
        (a) => (loaded.set(key, a), a),
        () => {
          loading.delete(key); // try again on the next request
          return null;
        },
      );
    loading.set(key, p);
  }
  return p;
}

/** The asset if it is loaded; starts loading it otherwise. */
export function assetNow(key: string): Asset | null | undefined {
  if (!loaded.has(key)) void loadAsset(key);
  return loaded.get(key);
}

export function useAsset(key: string): Asset | null {
  const [a, setA] = useState(() => assetNow(key) ?? null);
  useEffect(() => {
    let live = true;
    void loadAsset(key).then((x) => live && setA(x));
    return () => void (live = false);
  }, [key]);
  return a;
}

// ---------------------------------------------------------------------------------------------
// Canvas sprites

const bitmaps = new Map<string, HTMLCanvasElement>();

/**
 * `key` rasterised `width` CSS px wide (height follows the viewBox), ready for drawImage at that
 * size. Null until the SVG has loaded or when it does not exist.
 */
export function sprite(key: string, width: number, flip = false): HTMLCanvasElement | null {
  const dpr = devicePixelRatio || 1;
  const id = `${key}@${Math.round(width)}@${dpr}${flip ? "f" : ""}`;
  const hit = bitmaps.get(id);
  if (hit) return hit;
  const a = assetNow(key);
  if (!a) return null;
  const w = Math.round(width);
  const h = Math.round((w * a.h) / a.w);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const ctx = c.getContext("2d")!;
  if (flip) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(a.img, 0, 0, c.width, c.height);
  bitmaps.set(id, c);
  return c;
}

/** Height in CSS px of `key` drawn `width` wide (0 while unknown). */
export const spriteHeight = (key: string, width: number) => {
  const a = assetNow(key);
  return a ? (width * a.h) / a.w : 0;
};

/** Draws a sprite with its anchor (fractions of its size, default top centre) at (x, y). */
export function drawSprite(ctx: CanvasRenderingContext2D, bmp: HTMLCanvasElement, x: number, y: number, w: number, ax = 0.5, ay = 0) {
  const h = (w * bmp.height) / bmp.width;
  ctx.drawImage(bmp, x - w * ax, y - h * ay, w, h);
}
