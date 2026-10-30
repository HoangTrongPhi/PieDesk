import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Doc, FolderEntry, Op, SurfaceInfo } from "./types";

export const ipc = {
  surfaceInfo: () => invoke<SurfaceInfo | null>("surface_info"),
  storeGet: () => invoke<Doc>("store_get"),
  storeApply: (ops: Op[]) => invoke<number>("store_apply", { ops }),
  hitRects: (rects: [number, number, number, number][]) => invoke("hit_rects", { rects }),
  hitCapture: (capture: boolean) => invoke("hit_capture", { capture }),
  openPath: (path: string, admin = false) => invoke("open_path", { path, admin }),
  revealPath: (path: string) => invoke("reveal_path", { path }),
  listFolder: (path: string) => invoke<FolderEntry[]>("list_folder", { path }),
  watchFolder: (path: string) => invoke("watch_folder", { path }),
  unwatchFolder: (path: string) => invoke("unwatch_folder", { path }),
  hubSubscribe: (topic: string) => invoke("hub_subscribe", { topic }),
  hubUnsubscribe: (topic: string) => invoke("hub_unsubscribe", { topic }),
  openManager: (tab?: string) => invoke("open_manager", { tab }),
  toggleSurfaces: () => invoke("toggle_surfaces"),
};

/** Shell icon for a path, sized for the current DPI. Served by the Rust `icon://` protocol. */
export function iconUrl(path: string, cssPx: number, thumb = false): string {
  const px = Math.min(256, Math.ceil((cssPx * window.devicePixelRatio) / 16) * 16);
  return `${convertFileSrc(path, "icon")}?s=${px}${thumb ? "&t=1" : ""}`;
}

export const fileUrl = (path: string) => convertFileSrc(path);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function baseName(path: string): string {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
