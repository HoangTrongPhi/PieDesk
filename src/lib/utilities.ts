// IPC + types for the Utilities tab (src-tauri/src/cleanup.rs, optimize.rs).
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type CleanGroup = "system" | "browser" | "apps" | "dev" | "advanced";

export type CleanCategory = {
  id: string;
  group: CleanGroup;
  admin: boolean;
  defaultOn: boolean;
  caution: boolean;
  size: number;
  files: number;
  present: boolean;
  /** Some folders need admin rights to read: the size is a lower bound. */
  partial: boolean;
  /** Size only known after cleaning. */
  unknown: boolean;
  running: string[];
};

export type CleanResult = { id: string; freed: number; files: number; skipped: number; error: string | null };
export type Drive = { mount: string; name: string; total: number; free: number; system: boolean };
export type BigFile = { size: number; path: string; modified: number };

export type TweakId =
  | "power_plan" | "standby_ac" | "game_mode" | "game_dvr" | "hags" | "windowed_opt" | "mouse_accel"
  | "transparency" | "animations" | "background_apps" | "notifications" | "mmcss_games"
  | "svc_sysmain" | "svc_search" | "svc_diagtrack";
export type TweakValue = boolean | number | string;
export type TweakState = { id: TweakId; value: TweakValue | null; admin: boolean; reboot: boolean };
export type Overview = {
  profile: string | null;
  tweaks: TweakState[];
  planName: string;
  isAdmin: boolean;
  changed: string[];
  closed: string[];
  ultimate: string | null;
};
export type ChangeResult = { id: string; ok: boolean; error: string | null };
export type RamReport = { before: number; after: number; total: number; standby: { Ok: null } | { Err: string } | null };
export type ApplyReport = {
  results: ChangeResult[];
  unchanged: string[];
  closed: string[];
  relaunched: string[];
  ram: RamReport | null;
  reboot: boolean;
};
export type Rec = { id: string; level: "good" | "info" | "warn"; data: Record<string, unknown> | null };
export type StartupEntry = { name: string; command: string; path: string; scope: string; enabled: boolean; admin: boolean };

export type Program = {
  key: string;
  name: string;
  publisher: string;
  version: string;
  installed: string;
  size: number;
  location: string;
  icon: string;
  uninstall: string;
  quiet: string;
  machine: boolean;
  msi: boolean;
  /** Windows Installer cannot remove it as is (cached package gone / only its registration left). */
  broken: boolean;
};
export type Leftover = { kind: "folder" | "file" | "registry"; path: string; size: number; admin: boolean };
export type RemoveResult = { path: string; ok: boolean; error: string | null };
export type StoreApp = { name: string; fullName: string; publisher: string; version: string; location: string };

export const util = {
  scan: () => invoke<CleanCategory[]>("cleanup_scan"),
  clean: (ids: string[]) => invoke<CleanResult[]>("cleanup_clean", { ids }),
  drives: () => invoke<Drive[]>("cleanup_drives"),
  largeFiles: (root: string, minMb: number) => invoke<BigFile[]>("cleanup_large", { root, minMb }),
  recycle: (paths: string[]) => invoke("cleanup_recycle", { paths }),
  optimizeState: () => invoke<Overview>("optimize_state"),
  optimizeApply: (profile: string | null, changes: { id: TweakId; value: TweakValue }[], close: string[], freeRam: boolean) =>
    invoke<ApplyReport>("optimize_apply", { profile, changes, close, freeRam }),
  optimizeRestore: () => invoke<ApplyReport>("optimize_restore"),
  freeRam: (deep: boolean) => invoke<RamReport>("optimize_free_ram", { deep }),
  analyze: () => invoke<Rec[]>("optimize_analyze"),
  startupApps: () => invoke<StartupEntry[]>("startup_apps"),
  programs: () => invoke<Program[]>("uninstall_list"),
  uninstall: (key: string, file?: string) => invoke<number>("uninstall_run", { key, file: file ?? null }),
  stillInstalled: (key: string) => invoke<boolean>("uninstall_present", { key }),
  leftovers: (program: Program, force = false) => invoke<Leftover[]>("uninstall_leftovers", { program, force }),
  removeLeftovers: (items: Leftover[]) => invoke<RemoveResult[]>("uninstall_remove", { items }),
  storeApps: () => invoke<StoreApp[]>("store_list"),
  storeUninstall: (fullName: string) => invoke("store_uninstall", { fullName }),
  startupSet: (e: StartupEntry, enabled: boolean) => invoke("startup_set", { scope: e.scope, name: /folder$/i.test(e.scope) ? e.path.split("\\").pop() : e.name, enabled, admin: e.admin }),
};

/** Windows Installer exit codes that mean success (3010 / 1641: a restart is needed). */
export const MSI_OK = [0, 1641, 3010];

/** The admin helper (src-tauri/src/elevate.rs): granted once at install, no UAC prompt afterwards. */
export type AdminStatus = { granted: boolean; elevated: boolean; revoked: boolean };

type AdminState = {
  status: AdminStatus | null;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  grant: () => Promise<void>;
  revoke: () => Promise<void>;
};

export const useAdmin = create<AdminState>((set) => ({
  status: null,
  busy: false,
  error: null,
  refresh: async () => {
    const status = await invoke<AdminStatus>("admin_status").catch(() => null);
    set({ status });
  },
  grant: async () => {
    set({ busy: true, error: null });
    try {
      set({ status: await invoke<AdminStatus>("admin_grant") });
    } catch (e) {
      set({ error: String(e) });
    }
    set({ busy: false });
  },
  revoke: async () => {
    set({ busy: true, error: null });
    try {
      set({ status: await invoke<AdminStatus>("admin_revoke") });
    } catch (e) {
      set({ error: String(e) });
    }
    set({ busy: false });
  },
}));

/** Admin work runs without a UAC prompt (helper granted, or PieDesk runs as admin). */
export const useAdminQuiet = () => useAdmin((s) => !!s.status && (s.status.granted || s.status.elevated));

export function bytes(n: number, digits = 1): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`;
}
