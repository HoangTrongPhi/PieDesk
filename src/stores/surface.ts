// This surface's monitor and the display setup, refreshed by Rust on `surface://info`.

import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { tr } from "../lib/i18n";
import { ipc } from "../lib/ipc";
import type { Display, Rect, SurfaceInfo } from "../lib/types";

export const useSurface = create<{ info: SurfaceInfo | null }>(() => ({ info: null }));

let started = false;
export function initSurfaceInfo() {
  if (started) return;
  started = true;
  const load = () => ipc.surfaceInfo().then((info) => useSurface.setState({ info }));
  void listen("surface://info", load);
  void load();
}

export const displayName = (d: Display) => d.name || `${tr("Màn hình", "Display")} ${d.index + 1}`;

/** Same relative spot on another monitor, kept inside it. */
export function placeOn(rect: Rect, from: { width: number; height: number }, to: Display): { x: number; y: number } {
  const rel = (v: number, room: number) => (room > 0 ? Math.min(1, Math.max(0, v / room)) : 0);
  return {
    x: Math.round(rel(rect.x, from.width - rect.w) * Math.max(0, to.width - rect.w)),
    y: Math.round(rel(rect.y, from.height - rect.h) * Math.max(0, to.height - rect.h)),
  };
}
