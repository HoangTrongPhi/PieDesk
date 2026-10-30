// Self-update against the `latest.json` of the newest GitHub release (`plugins.updater` in
// tauri.conf.json). The installer is verified with the signing public key before it runs.
// Rust also checks in the background (release builds) and adds a tray item when one is found.

import { create } from "zustand";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { ipc } from "./ipc";

export type UpdatePhase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "error";

type UpdateState = {
  current: string;
  phase: UpdatePhase;
  available: { version: string; notes?: string } | null;
  progress: number | null;
  error: string | null;
  check: () => Promise<void>;
  installAndRestart: () => Promise<void>;
};

let pending: Update | null = null;

export const useUpdate = create<UpdateState>((set) => ({
  current: "",
  phase: "idle",
  available: null,
  progress: null,
  error: null,

  async check() {
    set({ phase: "checking", error: null });
    try {
      pending = await check();
      set(pending ? { phase: "available", available: { version: pending.version, notes: pending.body } } : { phase: "upToDate", available: null });
    } catch (e) {
      set({ phase: "error", error: String(e) });
    }
  },

  async installAndRestart() {
    if (!pending) return;
    set({ phase: "downloading", progress: 0 });
    try {
      // The installer quits PieDesk: write the debounced layout first.
      await ipc.storeFlush();
      let total = 0;
      let done = 0;
      await pending.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          set({ progress: total ? done / total : null });
        }
      });
      await relaunch();
    } catch (e) {
      set({ phase: "error", error: String(e) });
    }
  },
}));

getVersion()
  .then((current) => useUpdate.setState({ current }))
  .catch(() => {});
