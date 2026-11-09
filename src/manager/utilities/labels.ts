// Names and explanations for the Utilities tab. [vi, en] pairs, see src/lib/i18n.ts.
import type { Text } from "../../lib/i18n";
import type { CleanGroup, TweakId } from "../../lib/utilities";

export const GROUPS: { id: CleanGroup; label: Text }[] = [
  { id: "system", label: ["Windows", "Windows"] },
  { id: "browser", label: ["Trình duyệt (chỉ cache)", "Browsers (cache only)"] },
  { id: "apps", label: ["Ứng dụng & game", "Apps & games"] },
  { id: "dev", label: ["Lập trình — tải lại khi build", "Developer — downloaded again on build"] },
  { id: "advanced", label: ["Nâng cao", "Advanced"] },
];

const BROWSER_DESC: Text = ["Chỉ xoá cache; đăng nhập, cookie, lịch sử giữ nguyên.", "Cache only; logins, cookies and history stay."];
const DEV_DESC: Text = ["Gói đã tải về; công cụ sẽ tải lại khi cần.", "Downloaded packages; the tool fetches them again when needed."];

export const CLEAN: Record<string, { name: Text; desc: Text }> = {
  user_temp: { name: ["File tạm của bạn", "Your temp files"], desc: ["%TEMP% — bỏ qua file mới hơn 1 giờ và file đang mở.", "%TEMP% — skips files newer than an hour and files in use."] },
  win_temp: { name: ["File tạm Windows", "Windows temp files"], desc: ["C:\\Windows\\Temp.", "C:\\Windows\\Temp."] },
  recycle_bin: { name: ["Thùng rác", "Recycle Bin"], desc: ["Xoá hẳn mọi thứ trong Thùng rác ở mọi ổ.", "Permanently empties the Recycle Bin on every drive."] },
  thumbnails: { name: ["Cache ảnh thu nhỏ & icon", "Thumbnail & icon cache"], desc: ["Explorer tự tạo lại; file đang dùng được bỏ qua.", "Explorer rebuilds it; files in use are skipped."] },
  crash_user: { name: ["Crash dump & báo lỗi của app", "App crash dumps & error reports"], desc: ["CrashDumps và Windows Error Reporting của bạn.", "Your CrashDumps and Windows Error Reporting."] },
  crash_system: { name: ["Memory dump & báo lỗi hệ thống", "System memory dumps & reports"], desc: ["Minidump, MEMORY.DMP, LiveKernelReports, WER.", "Minidump, MEMORY.DMP, LiveKernelReports, WER."] },
  wu_cache: { name: ["Cache Windows Update", "Windows Update cache"], desc: ["Bản cập nhật đã tải về; dịch vụ Update tạm dừng khi dọn.", "Downloaded updates; the Update service pauses while cleaning."] },
  delivery_opt: { name: ["Delivery Optimization", "Delivery Optimization"], desc: ["Bản cập nhật chia sẻ qua mạng LAN / Internet.", "Updates shared over the LAN / Internet."] },
  win_logs: { name: ["Log Windows cũ", "Old Windows logs"], desc: ["Log hơn 7 ngày trong Logs, LogFiles, Panther.", "Logs older than 7 days in Logs, LogFiles, Panther."] },
  dns: { name: ["DNS cache", "DNS cache"], desc: ["Xoá bộ nhớ đệm tên miền (ipconfig /flushdns) — sửa lỗi web không vào được.", "Flushes cached name lookups (ipconfig /flushdns) — fixes sites that won't load."] },
  shader_cache: { name: ["Shader cache GPU", "GPU shader cache"], desc: ["DirectX / NVIDIA / AMD / Intel. Game biên dịch lại shader → giật nhẹ lần chạy đầu.", "DirectX / NVIDIA / AMD / Intel. Games recompile shaders → a little stutter on first run."] },
  chrome: { name: ["Google Chrome", "Google Chrome"], desc: BROWSER_DESC },
  edge: { name: ["Microsoft Edge", "Microsoft Edge"], desc: BROWSER_DESC },
  brave: { name: ["Brave", "Brave"], desc: BROWSER_DESC },
  vivaldi: { name: ["Vivaldi", "Vivaldi"], desc: BROWSER_DESC },
  opera: { name: ["Opera / Opera GX", "Opera / Opera GX"], desc: BROWSER_DESC },
  firefox: { name: ["Firefox", "Firefox"], desc: BROWSER_DESC },
  discord: { name: ["Discord", "Discord"], desc: ["Cache ảnh, video, GPU.", "Image, video and GPU cache."] },
  teams: { name: ["Microsoft Teams", "Microsoft Teams"], desc: ["Cache của Teams mới và Teams cũ.", "Cache of new and classic Teams."] },
  vscode: { name: ["VS Code / Cursor", "VS Code / Cursor"], desc: ["Cache, CachedData và log.", "Cache, CachedData and logs."] },
  spotify: { name: ["Spotify", "Spotify"], desc: ["Nhạc đã cache để phát lại; sẽ tải lại khi nghe.", "Songs cached for replay; streamed again when played."] },
  launchers: { name: ["Steam / Epic / Battle.net", "Steam / Epic / Battle.net"], desc: ["Web cache và log của launcher (game không bị ảnh hưởng).", "Launcher web cache and logs (games are untouched)."] },
  unreal_logs: { name: ["Unreal Engine — log & crash", "Unreal Engine — logs & crashes"], desc: ["Saved\\Logs, Saved\\Crashes của mọi phiên bản.", "Saved\\Logs, Saved\\Crashes of every version."] },
  unreal_ddc: { name: ["Unreal — Derived Data Cache", "Unreal — Derived Data Cache"], desc: ["Shader & asset đã build; mở project lần sau sẽ build lại khá lâu.", "Built shaders & assets; the next project open rebuilds them (slow)."] },
  maya: { name: ["Autodesk Maya — prefs\\tmp", "Autodesk Maya — prefs\\tmp"], desc: ["File tạm trong thư mục prefs của mọi phiên bản Maya.", "Temp files in the prefs folder of every Maya version."] },
  adobe_media: { name: ["Adobe Media Cache", "Adobe Media Cache"], desc: ["Premiere / After Effects tạo lại khi mở project.", "Premiere / After Effects rebuild it when a project opens."] },
  npm: { name: ["npm / Yarn cache", "npm / Yarn cache"], desc: DEV_DESC },
  pip: { name: ["pip cache", "pip cache"], desc: DEV_DESC },
  cargo: { name: ["Cargo registry", "Cargo registry"], desc: DEV_DESC },
  nuget: { name: ["NuGet cache", "NuGet cache"], desc: DEV_DESC },
  gradle: { name: ["Gradle cache", "Gradle cache"], desc: DEV_DESC },
  prefetch: { name: ["Prefetch", "Prefetch"], desc: ["Windows dùng để mở app nhanh hơn; xoá làm lần mở sau chậm hơn — thường không nên.", "Windows uses it to start apps faster; clearing slows the next launches — rarely worth it."] },
  hibernate: { name: ["Tắt ngủ đông (hiberfil.sys)", "Turn off hibernation (hiberfil.sys)"], desc: ["Giải phóng file ~40% dung lượng RAM; tắt luôn Hibernate và Fast Startup.", "Frees a file ~40 % the size of RAM; also turns off Hibernate and Fast Startup."] },
  component_store: { name: ["Dọn kho WinSxS", "Clean up WinSxS"], desc: ["DISM StartComponentCleanup: xoá bản cũ của cập nhật. Mất vài phút; không gỡ được update đã cài nữa.", "DISM StartComponentCleanup: removes superseded updates. Takes minutes; installed updates can't be uninstalled after."] },
};

export const TWEAK: Record<TweakId, { name: Text; desc: Text; group: "power" | "game" | "look" | "services" }> = {
  power_plan: { group: "power", name: ["Gói nguồn", "Power plan"], desc: ["Balanced hạ xung CPU khi rảnh; High / Ultimate giữ xung cao.", "Balanced clocks the CPU down when idle; High / Ultimate keep clocks up."] },
  standby_ac: { group: "power", name: ["Không tự ngủ khi cắm điện", "Never sleep on mains power"], desc: ["Máy không ngủ giữa chừng khi render, build, tải game.", "No sleeping in the middle of a render, build or download."] },
  game_mode: { group: "game", name: ["Game Mode", "Game Mode"], desc: ["Windows ưu tiên game, hoãn Windows Update khi đang chơi.", "Windows favours the game and holds Windows Update while you play."] },
  game_dvr: { group: "game", name: ["Xbox Game Bar quay nền", "Xbox Game Bar background capture"], desc: ["Quay sẵn để \"lưu 30 giây vừa rồi\" — tốn GPU & ổ đĩa.", "Records constantly for \"save the last 30 s\" — costs GPU & disk."] },
  hags: { group: "game", name: ["Lập lịch GPU phần cứng (HAGS)", "Hardware-accelerated GPU scheduling"], desc: ["Giảm độ trễ, cần cho DLSS Frame Generation. Cần khởi động lại.", "Lower latency, needed by DLSS Frame Generation. Needs a restart."] },
  windowed_opt: { group: "game", name: ["Tối ưu game cửa sổ / borderless", "Optimizations for windowed games"], desc: ["Game DX10/11 chạy cửa sổ được flip model: độ trễ như fullscreen.", "Windowed DX10/11 games get the flip model: fullscreen-like latency."] },
  mmcss_games: { group: "game", name: ["Ưu tiên CPU / GPU cho game (MMCSS)", "CPU / GPU priority for games (MMCSS)"], desc: ["Bộ lập lịch đa phương tiện dành ưu tiên cao cho luồng game, bỏ giới hạn mạng.", "The multimedia scheduler gives game threads high priority and lifts network throttling."] },
  mouse_accel: { group: "game", name: ["Tăng tốc chuột", "Mouse acceleration"], desc: ["\"Enhance pointer precision\" — tắt để ngắm bắn nhất quán.", "\"Enhance pointer precision\" — off for consistent aim."] },
  transparency: { group: "look", name: ["Hiệu ứng trong suốt", "Transparency effects"], desc: ["Kính mờ của taskbar, Start, cửa sổ.", "Frosted glass of the taskbar, Start, windows."] },
  animations: { group: "look", name: ["Hoạt ảnh giao diện", "Interface animations"], desc: ["Thu / phóng cửa sổ, hiệu ứng trong app.", "Window minimize / maximize, in-app animations."] },
  background_apps: { group: "look", name: ["App Store chạy nền", "Store apps in the background"], desc: ["App từ Microsoft Store được chạy khi bạn không mở chúng.", "Microsoft Store apps may run while you don't use them."] },
  notifications: { group: "look", name: ["Thông báo", "Notifications"], desc: ["Toast góc màn hình (Focus vẫn chặn khi chơi fullscreen).", "Corner toasts (Focus also mutes them in fullscreen games)."] },
  svc_sysmain: { group: "services", name: ["SysMain (Superfetch)", "SysMain (Superfetch)"], desc: ["Nạp trước app hay dùng vào RAM. Tắt tạm khi chơi để bớt đọc ổ.", "Preloads frequent apps into RAM. Paused while gaming to cut disk reads."] },
  svc_search: { group: "services", name: ["Windows Search (lập chỉ mục)", "Windows Search (indexing)"], desc: ["Lập chỉ mục file nền. Tạm dừng thì tìm kiếm trong Start chậm hơn.", "Indexes files in the background. While paused, Start search is slower."] },
  svc_diagtrack: { group: "services", name: ["Telemetry (DiagTrack)", "Telemetry (DiagTrack)"], desc: ["Gửi dữ liệu chẩn đoán cho Microsoft.", "Sends diagnostics to Microsoft."] },
};

export const TWEAK_GROUPS: { id: (typeof TWEAK)[TweakId]["group"]; label: Text }[] = [
  { id: "power", label: ["Nguồn điện", "Power"] },
  { id: "game", label: ["Game", "Gaming"] },
  { id: "look", label: ["Giao diện & nền", "Interface & background"] },
  { id: "services", label: ["Dịch vụ nền — tới lần khởi động lại", "Background services — until the next restart"] },
];
