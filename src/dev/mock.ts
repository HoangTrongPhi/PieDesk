// Browser-only fake backend (vite dev without Tauri) for previewing the UI.
// `?view=surface` shows a desktop surface over a sample wallpaper; anything else shows the manager.

import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Doc, Op } from "../lib/types";

export async function installMock() {
  const view = new URLSearchParams(location.search).get("view");
  mockWindows(view === "surface" ? "surface-0" : "manager");
  mockConvertFileSrc("windows");

  const q = new URLSearchParams(location.search);
  // ?theme=winter&pet=desktop previews a theme and its effects.
  const doc: Doc = {
    rev: 0,
    settings: { ...(q.get("theme") && { theme: q.get("theme") as Doc["settings"]["theme"], seasonal: false }), ...(q.get("pet") && { pet: q.get("pet") as "desktop" }) },
    boxes: {},
    widgets: {},
  };
  // ?widgets=calendar,nowplaying,gpu lays those widgets out in a row.
  const { widgetDef } = await import("../widgets/registry");
  let x = 40;
  for (const type of q.get("widgets")?.split(",") ?? []) {
    const def = widgetDef(type);
    if (!def) continue;
    doc.settings.initialized = true;
    doc.widgets[type] = { id: type, type, monitor: "display-a", x, y: 60, ...def.defaultSize, config: {}, opacity: 0.6 };
    x += def.defaultSize.w + 24;
  }
  const displays = [
    { id: "display-a", name: "DELL U2720Q", index: 0, primary: true, windowsPrimary: true, width: innerWidth, height: innerHeight },
    { id: "display-b", name: "", index: 1, primary: false, windowsPrimary: false, width: 1080, height: 1880 },
  ];
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
          return { label: "surface-0", monitor: displays[0].id, primary: true, monitors: displays.map((d) => d.id), displays, width: innerWidth, height: innerHeight };
        case "list_displays":
          return displays;
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
        case "app_catalog": {
          const app = (name: string, group: string) => ({ key: `c:\apps\${name.toLowerCase()}.exe`, name, link: `C:\Start Menu\${name}.lnk`, onDesktop: false, group, guess: group });
          return {
            groups: [
              { id: "code", vi: "Code Editor", en: "Code editors" },
              { id: "ide", vi: "IDE", en: "IDEs" },
              { id: "engine", vi: "Game Engine", en: "Game engines" },
              { id: "dcc", vi: "3D / Modeling", en: "3D / modeling" },
            ],
            apps: [app("Cursor", "code"), app("Rider", "ide"), app("Unity Hub", "engine"), app("Unreal Engine 5.6", "engine"), app("Blender 5.2", "dcc"), app("Marmoset Toolbag 5", "dcc"), app("Poseidon", "other")],
          };
        }
        case "take_app":
          return { path: a.link, origin: "kept" };
        case "gather_apps":
          return { added: ["Blender", "Unity Hub", "Discord"], already: 2 };
        case "autostart_get":
        case "autostart_set":
          return true;
        case "is_owned_item":
          return true;
        // Utilities (src/manager/utilities)
        case "cleanup_drives":
          return [
            { mount: "C:", name: "Samsung 990 PRO", total: 1000e9, free: 112e9, system: true },
            { mount: "M:", name: "Data", total: 2000e9, free: 845e9, system: false },
          ];
        case "cleanup_scan": {
          const c = (id: string, group: string, size: number, extra: Record<string, unknown> = {}) => ({
            id, group, size, files: Math.round(size / 9e4), admin: false, defaultOn: true, caution: false, present: true, partial: false, unknown: false, running: [], ...extra,
          });
          return new Promise((r) => setTimeout(() => r([
            c("user_temp", "system", 360e6), c("win_temp", "system", 0, { admin: true, partial: true }), c("recycle_bin", "system", 1.37e9),
            c("thumbnails", "system", 211e6), c("crash_user", "system", 398e6), c("wu_cache", "system", 389e6, { admin: true }),
            c("win_logs", "system", 110e6, { admin: true, partial: true }), c("dns", "system", 0), c("shader_cache", "system", 3.4e9, { caution: true, defaultOn: false }),
            c("chrome", "browser", 2.41e9, { running: ["chrome.exe"] }), c("edge", "browser", 555e6), c("brave", "browser", 398e6),
            c("discord", "apps", 390e6), c("teams", "apps", 695e6, { running: ["ms-teams.exe"] }), c("launchers", "apps", 944e6),
            c("unreal_logs", "apps", 1.2e6), c("unreal_ddc", "apps", 1.15e9, { caution: true, defaultOn: false }),
            c("npm", "dev", 1.5e9, { defaultOn: false }), c("pip", "dev", 4.28e9, { defaultOn: false }), c("cargo", "dev", 940e6, { defaultOn: false }),
            c("prefetch", "advanced", 0, { admin: true, caution: true, defaultOn: false, partial: true }),
            c("hibernate", "advanced", 13.7e9, { admin: true, caution: true, defaultOn: false }),
            c("component_store", "advanced", 0, { admin: true, caution: true, defaultOn: false, unknown: true }),
          ]), 900));
        }
        case "cleanup_clean":
          return new Promise((r) => setTimeout(() => r((a.ids as string[]).map((id) => ({ id, freed: 2.1e8, files: 1200, skipped: id === "chrome" ? 14 : 0, error: null }))), 1200));
        case "cleanup_large":
          return [
            { size: 48.2e9, path: "C:\\Users\\demo\\Videos\\capture_2026-10-01.mkv", modified: Date.now() - 3e9 },
            { size: 12.4e9, path: "C:\\Users\\demo\\Downloads\\UE_5.6_Installer.zip", modified: Date.now() - 9e9 },
            { size: 3.1e9, path: "C:\\Users\\demo\\Documents\\maya\\projects\\city\\cache\\sim.abc", modified: Date.now() - 2e9 },
          ];
        case "optimize_state":
          return {
            profile: null, planName: "Balanced", isAdmin: false, changed: [], closed: [], ultimate: null,
            tweaks: [
              ["power_plan", "381b4222-f694-41f0-9685-ff5bb260df2e"], ["standby_ac", 1800], ["game_mode", true], ["game_dvr", true],
              ["hags", true, true, true], ["windowed_opt", false], ["mouse_accel", false], ["transparency", true], ["animations", true],
              ["background_apps", true], ["notifications", true], ["mmcss_games", false, true], ["svc_sysmain", true, true],
              ["svc_search", true, true], ["svc_diagtrack", true, true],
            ].map(([id, value, admin = false, reboot = false]) => ({ id, value, admin, reboot })),
          };
        case "optimize_analyze":
          return [
            { id: "disk_low", level: "warn", data: { free: 112e9, total: 1000e9, mount: "C:" } },
            { id: "startup_many", level: "warn", data: { count: 19 } },
            { id: "power_balanced", level: "info", data: { name: "Balanced" } },
            { id: "game_dvr_on", level: "info", data: null },
            { id: "hiberfil", level: "info", data: { size: 13.7e9 } },
          ];
        case "optimize_apply":
        case "optimize_restore":
          return { results: [{ id: "game_dvr", ok: true, error: null }], unchanged: [], closed: ["C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe"], relaunched: [], ram: null, reboot: false };
        case "optimize_free_ram":
          return { before: 9.1e9, after: 12.6e9, total: 32e9, standby: a.deep ? { Ok: null } : null };
        case "startup_apps":
          return [
            { name: "Steam", command: "\"C:\\Program Files (x86)\\Steam\\steam.exe\" -silent", path: "C:\\Program Files (x86)\\Steam\\steam.exe", scope: "user", enabled: true, admin: false },
            { name: "OneDrive", command: "", path: "C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe", scope: "user", enabled: false, admin: false },
            { name: "PenTablet", command: "", path: "C:\\Program Files\\XPPen\\XPPenTablet.exe", scope: "machine", enabled: true, admin: true },
            { name: "ShareX", command: "", path: "C:\\Users\\demo\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\ShareX.lnk", scope: "folder", enabled: true, admin: false },
          ];
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
      emit("hub://gpu", {
        gpus: [{ name: "NVIDIA GeForce RTX 3070", load: 20 + Math.random() * 50, memUsed: 3.9e9 + Math.random() * 2e8, memTotal: 8589934592, temp: 52, power: 96, powerLimit: 240, fan: 38, clock: 1890 }],
        top: [
          { pid: 1, name: "UnrealEditor", path: "", mem: 2.2e9 },
          { pid: 2, name: "blender", path: "", mem: 8.9e8 },
          { pid: 3, name: "chrome", path: "", mem: 1.6e8 },
        ],
      });
    }, 1000);
    const t1 = Date.now();
    setInterval(() => {
      emit("hub://media", { app: "Spotify", title: "Lofi beats to code to", artist: "Chillhop Music", album: "Chillhop Essentials", playing: true, position: 42_000, duration: 214_000, updated: t1, canPrev: true, canNext: true, art: 0, artType: "" });
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
