import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ipc } from "../lib/ipc";
import type { BoxModel, Doc, Op, Settings, WidgetModel } from "../lib/types";

type DocState = Doc & {
  ready: boolean;
  init: () => Promise<void>;
  /** Applies locally right away, then sends to Rust (which re-broadcasts to other windows). */
  commit: (ops: Op[]) => void;
  upsertBox: (box: BoxModel) => void;
  patchBox: (id: string, patch: Partial<BoxModel>) => void;
  deleteBox: (id: string) => void;
  upsertWidget: (w: WidgetModel) => void;
  patchWidget: (id: string, patch: Partial<WidgetModel>) => void;
  deleteWidget: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
};

function applyOps(state: Doc, ops: Op[]): Partial<Doc> {
  let { boxes, widgets, settings } = state;
  for (const op of ops) {
    if (op.op === "settings") {
      settings = { ...settings, ...op.value };
    } else if (op.coll === "boxes") {
      boxes = { ...boxes };
      if (op.op === "upsert") boxes[op.id] = op.value as BoxModel;
      else delete boxes[op.id];
    } else {
      widgets = { ...widgets };
      if (op.op === "upsert") widgets[op.id] = op.value as WidgetModel;
      else delete widgets[op.id];
    }
  }
  return { boxes, widgets, settings };
}

export const useDoc = create<DocState>((set, get) => ({
  rev: 0,
  settings: {},
  boxes: {},
  widgets: {},
  ready: false,

  init: async () => {
    const me = getCurrentWebviewWindow().label;
    await listen<{ origin: string; rev: number; ops: Op[] }>("store://ops", ({ payload }) => {
      if (payload.origin === me) return;
      set((s) => ({ ...applyOps(s, payload.ops), rev: payload.rev }));
    });
    const doc = await ipc.storeGet();
    set({ ...doc, settings: doc.settings ?? {}, ready: true });
  },

  commit: (ops) => {
    set((s) => applyOps(s, ops));
    ipc.storeApply(ops).then((rev) => set({ rev }));
  },

  upsertBox: (box) => get().commit([{ op: "upsert", coll: "boxes", id: box.id, value: box }]),
  patchBox: (id, patch) => {
    const cur = get().boxes[id];
    if (cur) get().upsertBox({ ...cur, ...patch });
  },
  deleteBox: (id) => {
    // A shortcut box owns its items' shortcuts (src-tauri/src/items.rs): put moved ones back, drop the rest.
    const box = get().boxes[id];
    if (box?.kind === "shortcuts") box.items.forEach((i) => ipc.removeItem(i).catch(() => {}));
    get().commit([{ op: "delete", coll: "boxes", id }]);
  },
  upsertWidget: (w) => get().commit([{ op: "upsert", coll: "widgets", id: w.id, value: w }]),
  patchWidget: (id, patch) => {
    const cur = get().widgets[id];
    if (cur) get().upsertWidget({ ...cur, ...patch });
  },
  deleteWidget: (id) => get().commit([{ op: "delete", coll: "widgets", id }]),
  setSettings: (patch) => get().commit([{ op: "settings", value: patch }]),
}));

export const settingsWithDefaults = (s: Settings): Required<Settings> => ({
  initialized: s.initialized ?? false,
  locked: s.locked ?? false,
  launchMode: s.launchMode ?? "double",
  grid: s.grid ?? 8,
  hotkey: s.hotkey ?? "Alt+Shift+D",
  pauseOnFullscreen: s.pauseOnFullscreen ?? true,
  showLabels: s.showLabels ?? true,
  language: s.language ?? systemLang(),
  theme: s.theme ?? "neon",
  party: s.party ?? false,
  agentNotify: s.agentNotify ?? true,
  autoUpdate: s.autoUpdate ?? true,
  homeMonitor: s.homeMonitor ?? "",
});

export const systemLang = (): "vi" | "en" => (navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en");
