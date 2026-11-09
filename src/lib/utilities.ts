// IPC + types for the Utilities tab (src-tauri/src/cleanup.rs, optimize.rs).
import { invoke } from "@tauri-apps/api/core";

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
  startupSet: (e: StartupEntry, enabled: boolean) => invoke("startup_set", { scope: e.scope, name: /folder$/i.test(e.scope) ? e.path.split("\\").pop() : e.name, enabled, admin: e.admin }),
};

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
