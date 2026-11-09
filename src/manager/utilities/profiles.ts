// OptimizedPC profiles: which value each tweak gets. Rust saves the original of every tweak the
// first time it changes, so "Normal" restores exactly what the user had (src-tauri/src/optimize.rs).
import type { Text } from "../../lib/i18n";
import type { TweakId, TweakValue } from "../../lib/utilities";
import type { Settings } from "../../lib/types";

export type ProfileId = "gaming" | "working" | "normal";

export type Profile = {
  id: ProfileId;
  name: Text;
  tagline: Text;
  points: Text[];
  tweaks: Partial<Record<TweakId, TweakValue>>;
  /** Process names closed on apply (started again by Normal). */
  close: string[];
  /** Trim working sets + purge the standby list. */
  freeRam: boolean;
  /** Pause PieDesk's own effects (theme fx, overlay, Pie the cat). */
  quietPieDesk: boolean;
};

export const PROFILES: Profile[] = [
  {
    id: "gaming",
    name: ["Gaming", "Gaming"],
    tagline: ["Dồn mọi tài nguyên cho game", "Every resource for the game"],
    points: [
      ["Gói nguồn Ultimate / High Performance, không tự ngủ", "Ultimate / High Performance plan, no sleep"],
      ["Bật Game Mode, HAGS, tối ưu game cửa sổ, ưu tiên MMCSS", "Game Mode, HAGS, windowed optimizations, MMCSS priority"],
      ["Tắt quay nền Game Bar, tăng tốc chuột, thông báo", "Game Bar capture, mouse acceleration, notifications off"],
      ["Tắt trong suốt & hoạt ảnh, chặn app Store chạy nền", "No transparency or animations, Store apps kept from running"],
      ["Tạm dừng SysMain, Windows Search, telemetry", "SysMain, Windows Search, telemetry paused"],
      ["Đóng OneDrive, Teams, Phone Link, Widgets; dọn RAM", "Closes OneDrive, Teams, Phone Link, Widgets; frees RAM"],
      ["Tạm tắt hiệu ứng của chính PieDesk", "Pauses PieDesk's own effects"],
    ],
    tweaks: {
      power_plan: "ultimate",
      standby_ac: 0,
      game_mode: true,
      game_dvr: false,
      hags: true,
      windowed_opt: true,
      mmcss_games: true,
      mouse_accel: false,
      transparency: false,
      animations: false,
      background_apps: false,
      notifications: false,
      svc_sysmain: false,
      svc_search: false,
      svc_diagtrack: false,
    },
    close: ["OneDrive.exe", "ms-teams.exe", "Teams.exe", "PhoneExperienceHost.exe", "Widgets.exe", "AdobeCollabSync.exe"],
    freeRam: true,
    quietPieDesk: true,
  },
  {
    id: "working",
    name: ["Working", "Working"],
    tagline: ["Mượt cho app nặng: 3D, engine, IDE, Adobe", "Smooth heavy apps: 3D, engines, IDEs, Adobe"],
    points: [
      ["Gói nguồn High Performance, không ngủ giữa lúc render / build", "High Performance plan, no sleep mid-render / build"],
      ["Giữ SysMain & Windows Search (mở app, tìm file nhanh)", "Keeps SysMain & Windows Search (fast launches, file search)"],
      ["Bật lại thông báo, giao diện đầy đủ", "Notifications and the full interface on"],
      ["Tắt quay nền Game Bar, telemetry", "Game Bar capture and telemetry off"],
      ["Đóng Steam, Epic, Battle.net, EA, Riot, GOG", "Closes Steam, Epic, Battle.net, EA, Riot, GOG"],
    ],
    tweaks: {
      power_plan: "high",
      standby_ac: 0,
      game_dvr: false,
      mmcss_games: false,
      transparency: true,
      animations: true,
      background_apps: true,
      notifications: true,
      svc_sysmain: true,
      svc_search: true,
      svc_diagtrack: false,
    },
    close: ["steam.exe", "EpicGamesLauncher.exe", "Battle.net.exe", "EADesktop.exe", "RiotClientServices.exe", "GalaxyClient.exe"],
    freeRam: false,
    quietPieDesk: false,
  },
  {
    id: "normal",
    name: ["Normal", "Normal"],
    tagline: ["Trả máy về đúng như trước khi tối ưu", "Back to exactly how it was before"],
    points: [
      ["Mọi tinh chỉnh về giá trị gốc của bạn", "Every tweak back to your original value"],
      ["Mở lại các app đã bị đóng", "Restarts the apps that were closed"],
      ["Bật lại hiệu ứng PieDesk", "PieDesk effects back on"],
    ],
    tweaks: {},
    close: [],
    freeRam: false,
    quietPieDesk: false,
  },
];

/** PieDesk settings the Gaming profile pauses (saved in `optimizeFx`, put back by Normal). */
export const QUIET_KEYS = ["fx", "themeOverlay", "overlayFx", "pet", "decor"] as const;
export const QUIET: Partial<Settings> = { fx: false, themeOverlay: false, overlayFx: "off", pet: "off", decor: false };
