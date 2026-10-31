// Browser-only fake backend (vite dev without Tauri) for previewing the UI.
// `?view=surface` shows a desktop surface over a sample wallpaper; anything else shows the manager.

import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Doc, Op } from "../lib/types";

export async function installMock() {
  const view = new URLSearchParams(location.search).get("view");
  mockWindows(view === "surface" ? "surface-0" : "manager");
  mockConvertFileSrc("windows");

  const doc: Doc = { rev: 0, settings: {}, boxes: {}, widgets: {} };
  const folder = ["Blender 5.1.lnk", "Discord.lnk", "Unity Hub.lnk", "PureRef.lnk", "notes.txt", "Refs"].map((n) => ({
    name: n.replace(/\.[^.]+$/, ""),
    path: `C:\\Users\\demo\\Desktop\\${n}`,
    isDir: !n.includes("."),
    ext: n.split(".")[1]?.toLowerCase() ?? "",
  }));

  mockIPC(
    (cmd, args) => {
      const a = args as Record<string, unknown>;
      switch (cmd) {
        case "surface_info":
          return { label: "surface-0", monitor: "DISPLAY1", primary: true, monitors: ["DISPLAY1"], width: innerWidth, height: innerHeight };
        case "store_get":
          return structuredClone(doc);
        case "store_apply":
          for (const op of a.ops as Op[]) {
            if (op.op === "settings") Object.assign(doc.settings, op.value);
            else if (op.op === "upsert") (doc[op.coll] as Record<string, unknown>)[op.id] = op.value;
            else delete doc[op.coll][op.id];
          }
          return ++doc.rev;
        case "list_folder":
          return folder;
        case "plugin:path|resolve_directory":
          return "C:\\Users\\demo\\Desktop";
        case "plugin:autostart|is_enabled":
          return false;
        case "plugin:app|version":
          return "0.1.0";
        case "plugin:updater|check":
          return null;
        case "import_item":
          return { path: a.path, origin: "moved" };
        case "claim_item":
          return "moved";
        case "gather_apps":
          return { added: ["Blender", "Unity Hub", "Discord"], already: 2 };
        case "autostart_get":
        case "autostart_set":
          return true;
        case "is_owned_item":
          return true;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );

  if (view === "surface") {
    document.body.style.background = "radial-gradient(circle at 30% 70%, #1d4ed8 0%, #0b1a4a 45%, #050816 100%)";
    // Live-ish data for the system widgets.
    const { emit } = await import("@tauri-apps/api/event");
    setInterval(() => {
      const cpu = 10 + Math.random() * 40;
      emit("hub://cpu", { total: cpu, cores: Array.from({ length: 12 }, () => Math.random() * 100) });
      emit("hub://mem", { used: 14.2e9 + Math.random() * 1e9, total: 32e9 });
      emit("hub://net", { rx: Math.random() * 3e6, tx: Math.random() * 4e5 });
    }, 1000);
    // Agents: one Claude session finishes 8 s after load, so the bell can be seen ringing.
    const t0 = Date.now();
    setInterval(() => {
      const done = Date.now() - t0 > 8000;
      const sessions = [
        { id: "claude:a", source: "claude", title: "PieDesk: themes + agents widget", project: "PieDesk", state: done ? "done" : "working", updated: done ? t0 + 8000 : Date.now() },
        { id: "antigravity:b", source: "antigravity", title: "Run Current Project V2", project: "Project_P", state: "waiting", updated: t0 - 200_000 },
        { id: "claude:c", source: "claude", title: "Abyss folder cleanup", project: "Gogo_Gadgets", state: "done", updated: t0 - 900_000 },
      ];
      emit("hub://agents", { sessions, finished: done && Date.now() - t0 < 10_000 ? ["claude:a"] : [] });
    }, 2000);
  }
}
