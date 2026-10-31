import { useEffect, useState } from "react";
import clsx from "clsx";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppWindow, ArrowUpCircle, Box, Cpu, EyeOff, FolderOpen, LayoutGrid, Plus, RefreshCw, Settings, Sparkles, Trash2 } from "lucide-react";
import { useAppearance } from "../lib/appearance";
import { tr, tx, useLang, type Text } from "../lib/i18n";
import { baseName, ipc } from "../lib/ipc";
import { useUpdate } from "../lib/update";
import type { Display, ThemeId } from "../lib/types";
import { settingsWithDefaults, useDoc } from "../stores/doc";
import { displayName } from "../stores/surface";
import { Field, Segmented, Toggle } from "../widgets/fields";
import { WIDGETS, widgetDef } from "../widgets/registry";
import { ACCENTS } from "../surface/BoxView";
import { newBox, newWidget } from "../surface/Surface";

type Tab = "layout" | "widgets" | "settings" | "about";

const TABS: { id: Tab; label: Text; icon: typeof Box }[] = [
  { id: "layout", label: ["Bố cục", "Layout"], icon: LayoutGrid },
  { id: "widgets", label: ["Thư viện widget", "Widget gallery"], icon: Sparkles },
  { id: "settings", label: ["Cài đặt", "Settings"], icon: Settings },
  { id: "about", label: ["Kiến trúc", "Architecture"], icon: Cpu },
];

/** Theme previews: panel, border and accent colours mirror the CSS tokens in styles.css. */
export const THEMES: { id: ThemeId; name: string; desc: Text; panel: string; border: string; accent: string }[] = [
  { id: "neon", name: "Neon Room", desc: ["HUD sci-fi, chữ mono, viền xanh neon", "Sci-fi HUD, mono type, neon cyan edges"], panel: "#061225", border: "#4f8fcf", accent: "#66e0ff" },
  { id: "midnight", name: "Midnight", desc: ["Kính tối gọn gàng, mặc định cũ", "Clean dark glass, the original look"], panel: "#0e111b", border: "#2a2f3c", accent: "#6c8cff" },
  { id: "aurora", name: "Aurora", desc: ["Tím hồng ấm, viền gradient", "Warm violet and pink, gradient edges"], panel: "#1a0f2e", border: "#7b4bc4", accent: "#ff6bd6" },
  { id: "ember", name: "Ember", desc: ["Than hồng cam ấm, hợp hình nền tối", "Warm amber glow for dark wallpapers"], panel: "#1e100a", border: "#a8642f", accent: "#ffb547" },
];

// Items created here have no monitor yet: surfaces show unknown monitors on the home one.
const PRIMARY = "";

/** Connected monitors, kept fresh when the setup changes. */
function useDisplays() {
  const [displays, setDisplays] = useState<Display[]>([]);
  useEffect(() => {
    const load = () => ipc.listDisplays().then(setDisplays).catch(() => {});
    void load();
    const un = listen("surface://info", load);
    return () => void un.then((f) => f());
  }, []);
  return displays;
}

export function Manager() {
  const initial = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? (initial as Tab) : "layout");
  const ready = useDoc((s) => s.ready);
  useLang();
  useAppearance();

  useEffect(() => {
    useDoc.getState().init();
    const un = listen<string>("manager://tab", ({ payload }) => setTab(payload as Tab));
    return () => void un.then((f) => f());
  }, []);

  return (
    <div className="pd-manager flex h-screen">
      <nav className="pd-sidebar flex w-56 shrink-0 flex-col gap-1 p-3">
        <div className="mb-4 flex items-center gap-2.5 px-2 pt-1">
          <img src="/app-icon.svg" className="size-8" alt="" />
          <div>
            <div className="text-[15px] font-semibold">PieDesk</div>
            <div className="pd-muted text-[11px]">Desktop boxes & widgets</div>
          </div>
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={clsx("pd-nav", tab === t.id && "pd-nav-active")} onClick={() => setTab(t.id)}>
            <t.icon size={16} strokeWidth={1.8} />
            {tx(t.label)}
          </button>
        ))}
        <div className="flex-1" />
        <button className="pd-nav" onClick={() => ipc.toggleSurfaces()}>
          <EyeOff size={16} strokeWidth={1.8} />
          {tr("Ẩn / hiện desktop", "Show / hide desktop")}
        </button>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto p-8">
        {!ready ? null : tab === "layout" ? <LayoutTab /> : tab === "widgets" ? <WidgetsTab /> : tab === "settings" ? <SettingsTab /> : <AboutTab />}
      </main>
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="pd-muted mt-1 text-sm">{sub}</p>
    </div>
  );
}

function LayoutTab() {
  const { boxes, widgets, upsertBox, deleteBox, deleteWidget } = useDoc();
  const displays = useDisplays();
  const home = displays.find((d) => d.primary);
  const monitorLabel = (id: string) => {
    const d = displays.find((d) => d.id === id);
    if (d) return displayName(d);
    return `${home ? displayName(home) : tr("màn hình chính", "home monitor")}${id ? tr(" (màn hình gốc đang rút)", " (its monitor is unplugged)") : ""}`;
  };
  const count = Object.keys(boxes).length;
  const addFolderBox = async () => {
    const dir = await openDialog({ directory: true, title: tr("Thư mục cho Folder Box", "Folder for the Folder Box") });
    if (typeof dir === "string")
      upsertBox(newBox(PRIMARY, { x: 60 + count * 24, y: 60 + count * 24 }, { kind: "folder", folder: dir, title: baseName(dir) }));
  };
  return (
    <>
      <Heading
        title={tr("Bố cục", "Layout")}
        sub={tr(
          "Box chứa shortcut hoặc phản chiếu một thư mục thật. Kéo thả file từ Explorer vào box để thêm.",
          "A box holds shortcuts or mirrors a real folder. Drag files from Explorer onto a box to add them.",
        )}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <button className="pd-btn pd-btn-primary" onClick={() => upsertBox(newBox(PRIMARY, { x: 60 + count * 24, y: 60 + count * 24 }))}>
          <Plus size={15} /> {tr("Box shortcut", "Shortcut box")}
        </button>
        <button className="pd-btn" onClick={addFolderBox}>
          <FolderOpen size={15} /> {tr("Folder Box (thư mục live)", "Folder Box (live folder)")}
        </button>
        <GatherButton />
      </div>

      <h2 className="pd-h2">Box ({count})</h2>
      <div className="pd-list">
        {Object.values(boxes).map((b) => (
          <div key={b.id} className="pd-row">
            <span className="size-2.5 rounded-full" style={{ background: b.accent }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{b.title}</div>
              <div className="pd-muted truncate text-xs">
                {b.kind === "folder" ? `${tr("Thư mục", "Folder")}: ${b.folder}` : `${b.items.length} ${tr("mục", "items")}`} ·{" "}
                {monitorLabel(b.monitor)}
              </div>
            </div>
            <div className="flex gap-1">
              {ACCENTS.slice(0, 5).map((c) => (
                <button key={c} className={clsx("size-4 rounded-full", b.accent === c && "ring-2 ring-white")} style={{ background: c }}
                  onClick={() => upsertBox({ ...b, accent: c })} />
              ))}
            </div>
            <button className="pd-icon-btn text-rose-300" title={tr("Xoá", "Delete")} onClick={() => deleteBox(b.id)}><Trash2 size={15} /></button>
          </div>
        ))}
        {count === 0 && <div className="pd-empty">{tr("Chưa có box nào.", "No boxes yet.")}</div>}
      </div>

      <h2 className="pd-h2 mt-8">Widget ({Object.keys(widgets).length})</h2>
      <div className="pd-list">
        {Object.values(widgets).map((w) => {
          const def = widgetDef(w.type);
          const Icon = def?.icon ?? Sparkles;
          return (
            <div key={w.id} className="pd-row">
              <Icon size={16} className="pd-muted" />
              <div className="flex-1 text-sm">{def ? tx(def.name) : w.type}</div>
              <span className="pd-muted text-xs">{w.w}×{w.h}</span>
              <button className="pd-icon-btn text-rose-300" title={tr("Xoá", "Delete")} onClick={() => deleteWidget(w.id)}><Trash2 size={15} /></button>
            </div>
          );
        })}
        {Object.keys(widgets).length === 0 && (
          <div className="pd-empty">{tr("Chưa có widget nào — thêm ở “Thư viện widget”.", "No widgets yet — add some from the Widget gallery.")}</div>
        )}
      </div>
    </>
  );
}

/** Puts a shortcut for every installed program that is in no box yet on the desktop. */
function GatherButton() {
  const [state, setState] = useState<"idle" | "busy" | { added: string[]; already: number } | string>("idle");
  return (
    <>
      <button className="pd-btn" disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          setState(await ipc.gatherApps().catch((e) => String(e)));
        }}>
        <AppWindow size={15} /> {state === "busy" ? tr("Đang thu gom…", "Gathering…") : tr("Thu gom shortcut ứng dụng ra desktop", "Gather app shortcuts onto the desktop")}
      </button>
      {typeof state === "object" && (
        <p className="pd-muted basis-full text-xs leading-relaxed" title={state.added.join(", ")}>
          {state.added.length
            ? tr(`Đã đặt ${state.added.length} shortcut ra desktop — kéo chúng vào box.`, `Put ${state.added.length} shortcuts on the desktop — drag them into boxes.`)
            : tr("Không còn ứng dụng nào ngoài box.", "Every app already has a shortcut.")}
          {state.already > 0 && tr(` Bỏ qua ${state.already} ứng dụng đã có trong box / trên desktop.`, ` Skipped ${state.already} already in a box / on the desktop.`)}
        </p>
      )}
      {typeof state === "string" && state !== "idle" && state !== "busy" && <p className="basis-full text-xs text-rose-300">{state}</p>}
    </>
  );
}

function WidgetsTab() {
  const { widgets, upsertWidget } = useDoc();
  const [added, setAdded] = useState<string | null>(null);
  return (
    <>
      <Heading
        title={tr("Thư viện widget", "Widget gallery")}
        sub={tr(
          "Bấm để thêm lên desktop màn hình chính, rồi kéo thanh ⋯ phía trên widget để di chuyển.",
          "Click to add to the primary desktop, then drag the ⋯ bar above a widget to move it.",
        )}
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {WIDGETS.map((def) => {
          const n = Object.values(widgets).filter((w) => w.type === def.type).length;
          return (
            <button key={def.type} className="pd-card text-left"
              onClick={() => {
                const w = newWidget(def.type, PRIMARY, { x: 120 + n * 24, y: 120 + n * 24 });
                if (w) upsertWidget(w);
                setAdded(def.type);
                setTimeout(() => setAdded(null), 1200);
              }}>
              <div className="mb-3 flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-lg bg-[var(--pd-accent)]/15 text-[var(--pd-accent)]"><def.icon size={18} /></span>
                {n > 0 && <span className="pd-muted text-[11px]">{tr("đang dùng", "in use")} {n}</span>}
              </div>
              <div className="text-sm font-semibold">{tx(def.name)}</div>
              <div className="pd-muted mt-1 text-xs leading-relaxed">{tx(def.description)}</div>
              <div className="mt-3 text-xs font-medium text-[var(--pd-accent)]">
                {added === def.type ? tr("✓ Đã thêm", "✓ Added") : tr("+ Thêm lên desktop", "+ Add to desktop")}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function SettingsTab() {
  const raw = useDoc((s) => s.settings);
  const settings = settingsWithDefaults(raw);
  const set = useDoc((s) => s.setSettings);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [hotkey, setHotkey] = useState(settings.hotkey);
  const displays = useDisplays();

  useEffect(() => {
    ipc.autostartGet().then(setAutostart).catch(() => setAutostart(null));
  }, []);

  return (
    <>
      <Heading title={tr("Cài đặt", "Settings")} sub={tr("Thay đổi được áp dụng ngay cho mọi màn hình.", "Changes apply to every monitor right away.")} />
      <div className="flex max-w-2xl flex-col gap-6">
        <section className="pd-section">
          <Field label={tr("Ngôn ngữ", "Language")}>
            <Segmented value={settings.language} onChange={(language) => set({ language })}
              options={[{ value: "vi", label: "Tiếng Việt" }, { value: "en", label: "English" }]} />
          </Field>
          <Field label={tr("Giao diện", "Theme")}>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <button key={t.id} className={clsx("pd-theme", settings.theme === t.id && "pd-theme-active")} onClick={() => set({ theme: t.id })}>
                  <span className="pd-theme-swatch" style={{ background: t.panel, borderColor: t.border, color: t.accent }}>
                    <i style={{ background: t.accent }} />
                    Aa
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="pd-muted block text-[11.5px] leading-snug">{tx(t.desc)}</span>
                  </span>
                </button>
              ))}
            </div>
          </Field>
          <Toggle label={tr("Party mode — LED RGB chạy quanh viền box & widget", "Party mode — RGB LEDs chasing around boxes & widgets")}
            checked={settings.party} onChange={(party) => set({ party })} />
        </section>
        <section className="pd-section">
          <Field label={tr("Màn hình chính của PieDesk", "PieDesk home monitor")}
            hint={tr(
              "Box mới và box của màn hình đang rút ra sẽ hiện ở đây. Kéo box qua mép màn hình để chuyển sang màn khác.",
              "New boxes, and boxes of an unplugged monitor, show here. Drag a box past the screen edge to move it to another monitor.",
            )}>
            <Segmented value={displays.some((d) => d.id === settings.homeMonitor) ? settings.homeMonitor : ""}
              onChange={(homeMonitor) => set({ homeMonitor })}
              options={[
                { value: "", label: tr("Theo Windows", "Same as Windows") },
                ...displays.map((d) => ({ value: d.id, label: `${displayName(d)}${d.windowsPrimary ? " ★" : ""}` })),
              ]} />
          </Field>
        </section>
        <section className="pd-section">
          <Toggle label={tr("Khởi động cùng Windows", "Start with Windows")} checked={!!autostart}
            onChange={async (v) => {
              await ipc.autostartSet(v).catch(() => {});
              setAutostart(await ipc.autostartGet().catch(() => v));
            }} />
          <Toggle label={tr("Khoá bố cục (không kéo / đổi cỡ được)", "Lock layout (no moving / resizing)")} checked={settings.locked}
            onChange={(locked) => set({ locked })} />
          <Toggle label={tr("Hiện tên dưới icon", "Show labels under icons")} checked={settings.showLabels} onChange={(showLabels) => set({ showLabels })} />
          <Toggle label={tr("Tạm dừng khi chơi game / app toàn màn hình", "Pause while a game / fullscreen app runs")} checked={settings.pauseOnFullscreen}
            onChange={(pauseOnFullscreen) => set({ pauseOnFullscreen })} />
          <Toggle label={tr("Thông báo Windows khi Claude / Antigravity làm xong", "Windows notification when Claude / Antigravity finishes")}
            checked={settings.agentNotify} onChange={(agentNotify) => set({ agentNotify })} />
        </section>
        <UpdateSection />
        <section className="pd-section">
          <Field label={tr("Mở item bằng", "Open items with")}>
            <Segmented value={settings.launchMode} onChange={(launchMode) => set({ launchMode })}
              options={[{ value: "double", label: "Double-click" }, { value: "single", label: tr("Click đơn", "Single click") }]} />
          </Field>
          <Field label={tr("Lưới bám (px)", "Snap grid (px)")}>
            <Segmented value={String(settings.grid)} onChange={(g) => set({ grid: Number(g) })}
              options={["1", "4", "8", "16", "24"].map((g) => ({ value: g, label: g === "1" ? tr("Tắt", "Off") : g }))} />
          </Field>
          <Field label={tr("Phím tắt ẩn / hiện desktop", "Show / hide hotkey")}
            hint={tr("Ví dụ: Alt+Shift+D, Ctrl+Alt+Space. Để trống để tắt.", "e.g. Alt+Shift+D, Ctrl+Alt+Space. Leave empty to disable.")}>
            <div className="flex gap-2">
              <input className="pd-input flex-1" value={hotkey} onChange={(e) => setHotkey(e.target.value)} />
              <button className="pd-btn" onClick={() => set({ hotkey: hotkey.trim() })} disabled={hotkey.trim() === settings.hotkey}>
                {tr("Lưu", "Save")}
              </button>
            </div>
          </Field>
        </section>
      </div>
    </>
  );
}

function UpdateSection() {
  const { current, phase, available, progress, error, check, installAndRestart } = useUpdate();
  const auto = settingsWithDefaults(useDoc((s) => s.settings)).autoUpdate;
  const set = useDoc((s) => s.setSettings);
  const busy = phase === "checking" || phase === "downloading";
  const status =
    phase === "checking" ? tr("Đang kiểm tra…", "Checking…")
    : phase === "upToDate" ? tr("Bạn đang dùng bản mới nhất.", "You are on the latest version.")
    : phase === "available" ? tr(`Đã có bản v${available?.version}.`, `Version ${available?.version} is available.`)
    : phase === "downloading" ? tr("Đang tải bản cập nhật…", "Downloading the update…") + (progress != null ? ` ${Math.round(progress * 100)}%` : "")
    : phase === "error" ? tr("Không kiểm tra được: ", "Could not check: ") + error
    : "";
  return (
    <section className="pd-section">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{tr("Cập nhật", "Updates")} · PieDesk v{current}</div>
          {status && <div className={clsx("mt-0.5 text-xs", phase === "error" ? "text-rose-300" : "pd-muted")}>{status}</div>}
        </div>
        {phase === "available" ? (
          <button className="pd-btn pd-btn-primary shrink-0" onClick={installAndRestart}>
            <ArrowUpCircle size={15} /> {tr("Cài & khởi động lại", "Install & restart")}
          </button>
        ) : (
          <button className="pd-btn shrink-0" disabled={busy} onClick={check}>
            <RefreshCw size={14} className={clsx(busy && "animate-spin")} /> {tr("Kiểm tra cập nhật", "Check for updates")}
          </button>
        )}
      </div>
      {available?.notes && phase === "available" && <p className="pd-muted text-xs leading-relaxed whitespace-pre-line">{available.notes}</p>}
      <Toggle label={tr("Tự kiểm tra bản mới (mỗi 12 giờ)", "Check for new versions automatically (every 12 h)")} checked={auto}
        onChange={(autoUpdate) => set({ autoUpdate })} />
    </section>
  );
}

const POINTS: [Text, Text][] = [
  [["Một surface / màn hình", "One surface per monitor"],
    ["Mọi box và widget nằm chung một WebView trong suốt cho mỗi màn hình, thay vì một cửa sổ cho mỗi box → RAM gần như không tăng khi thêm box.",
      "Every box and widget shares one transparent WebView per monitor instead of a window per box, so adding boxes costs almost no RAM."]],
  [["Hit-test ở Rust", "Hit-testing in Rust"],
    ["Một luồng nhẹ so con trỏ chuột với vùng box/widget và chỉ bật click-through khi trạng thái đổi. Vùng trống luôn “xuyên” xuống desktop.",
      "A light thread compares the cursor with box/widget rects and flips click-through only on change. Empty space always clicks through to the desktop."]],
  [["Ghim vào desktop", "Pinned to the desktop"],
    ["Owner = Progman + luôn HWND_BOTTOM: không bị Win+D ẩn, không bao giờ che app khác.",
      "Owned by Progman and kept at HWND_BOTTOM: survives Win+D and never covers other apps."]],
  [["Icon pipeline", "Icon pipeline"],
    ["Icon lấy từ Windows Shell, mã hoá PNG, cache RAM + đĩa theo hash, phục vụ qua giao thức icon:// — không base64 qua IPC.",
      "Shell icons encoded as PNG, cached in RAM and on disk by hash, served over icon:// — no base64 over IPC."]],
  [["Data hub pub/sub", "Pub/sub data hub"],
    ["CPU/RAM/mạng/ổ đĩa/agent chỉ được đo khi có widget đang nghe topic đó.",
      "CPU / RAM / network / disks / agents are only measured while a widget listens to that topic."]],
  [["Game guard", "Game guard"],
    ["Khi có app toàn màn hình (game, video, trình chiếu), PieDesk ẩn surface và ngừng đo → ~0% CPU.",
      "While a fullscreen app runs (game, video, slideshow) PieDesk hides its surfaces and stops measuring → ~0 % CPU."]],
  [["Store dạng ops", "Op-based store"],
    ["Mọi thay đổi là upsert/delete gửi về Rust, phát lại cho các màn hình khác, ghi đĩa có debounce + atomic rename.",
      "Every change is an upsert/delete sent to Rust, rebroadcast to other monitors and written with a debounce + atomic rename."]],
];

function AboutTab() {
  return (
    <>
      <Heading title={tr("Kiến trúc", "Architecture")} sub={tr("Tóm tắt — bản đầy đủ ở docs/ARCHITECTURE.md.", "Summary — the full version is in docs/ARCHITECTURE.md.")} />
      <div className="grid max-w-3xl gap-3">
        {POINTS.map(([t, d]) => (
          <div key={t[1]} className="pd-section !gap-1">
            <div className="text-sm font-semibold">{tx(t)}</div>
            <div className="pd-muted text-sm leading-relaxed">{tx(d)}</div>
          </div>
        ))}
      </div>
    </>
  );
}
