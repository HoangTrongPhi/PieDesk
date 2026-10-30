// Tells Rust which parts of the transparent surface take the mouse (see src-tauri/src/hittest.rs).
// Every element with `data-hit` counts. Reports are coalesced to one per frame and only sent
// when the rects actually changed.

import { useEffect } from "react";
import { ipc } from "./ipc";

let frame = 0;
let last = "";

function measure() {
  frame = 0;
  const rects: [number, number, number, number][] = [];
  document.querySelectorAll<HTMLElement>("[data-hit]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push([Math.floor(r.x), Math.floor(r.y), Math.ceil(r.width), Math.ceil(r.height)]);
  });
  const key = JSON.stringify(rects);
  if (key !== last) {
    last = key;
    ipc.hitRects(rects).catch(() => {});
  }
}

export function scheduleHitReport() {
  if (!frame) frame = requestAnimationFrame(measure);
}

/** Mount once on the surface root. */
export function useHitReporter(root: HTMLElement | null) {
  useEffect(() => {
    if (!root) return;
    const mo = new MutationObserver(scheduleHitReport);
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "data-hit"] });
    const ro = new ResizeObserver(scheduleHitReport);
    ro.observe(root);
    window.addEventListener("resize", scheduleHitReport);
    scheduleHitReport();
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", scheduleHitReport);
    };
  }, [root]);
}

// Capture = the whole surface takes the mouse (drag in progress, menu or dialog open).
let captures = 0;

export function pushCapture() {
  if (captures++ === 0) ipc.hitCapture(true).catch(() => {});
}

export function popCapture() {
  captures = Math.max(0, captures - 1);
  if (captures === 0) ipc.hitCapture(false).catch(() => {});
}

export function useCapture(active: boolean) {
  useEffect(() => {
    if (!active) return;
    pushCapture();
    return popCapture;
  }, [active]);
}
