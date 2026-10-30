import { useEffect } from "react";
import { create } from "zustand";
import clsx from "clsx";
import { listen } from "@tauri-apps/api/event";
import { Bell, BellRing, Bot, Check, Hourglass, Loader2 } from "lucide-react";
import { tr } from "../lib/i18n";
import { ipc } from "../lib/ipc";
import { Field, Segmented, Toggle } from "./fields";
import { useNow } from "./hooks";
import { defineWidget } from "./types";

// Watches Claude Code and Antigravity sessions (read by src-tauri/src/agents.rs) and rings a
// bell when one finishes. Rust detects the working → done transition, so every widget instance
// (and the Windows toast) agrees on what just finished.

type Source = "claude" | "antigravity";
type Session = { id: string; source: Source; title: string; project: string; state: "working" | "waiting" | "done"; updated: number };
type Config = { claude: boolean; antigravity: boolean; showDone: "recent" | "all" | "none"; sound: boolean };

const SOURCES: Record<Source, { name: string; short: string; color: string }> = {
  claude: { name: "Claude Code", short: "C", color: "#d97757" },
  antigravity: { name: "Antigravity", short: "A", color: "#4f8cff" },
};
const RECENT_MS = 60 * 60 * 1000;

/** Shared by every Agents widget: latest sessions, and the finished ones nobody acknowledged yet. */
const useAgents = create<{ sessions: Session[]; unread: Record<string, number> }>(() => ({ sessions: [], unread: {} }));

let listening = false;
let soundOn = true;

/** All instances share one event listener (kept for the page's lifetime, so StrictMode's quick
 *  mount/unmount cannot strand a half-removed listener) and one ref-counted hub subscription. */
function useAgentFeed(sound: boolean) {
  soundOn = sound;
  useEffect(() => {
    if (!listening) {
      listening = true;
      listen<{ sessions: Session[]; finished: string[] }>("hub://agents", ({ payload }) => {
        const now = Date.now();
        useAgents.setState((s) => {
          const unread = { ...s.unread };
          payload.finished.forEach((id) => (unread[id] = now));
          return { sessions: payload.sessions, unread };
        });
        if (payload.finished.length && soundOn) chime();
      });
    }
    ipc.hubSubscribe("agents").catch(() => {});
    return () => void ipc.hubUnsubscribe("agents").catch(() => {});
  }, []);
}

/** Two-note "ding" synthesised with Web Audio — no sound file to ship. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.16;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.95);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // No audio device: the bell still rings visually.
  }
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

export default defineWidget<Config>({
  type: "agents",
  name: ["Agent sessions", "Agent sessions"],
  description: [
    "Theo dõi session Claude Code & Antigravity đang chạy; chuông + thông báo khi làm xong.",
    "Tracks running Claude Code & Antigravity sessions; bell + notification when one finishes.",
  ],
  icon: Bot,
  defaultSize: { w: 320, h: 230 },
  minSize: { w: 220, h: 100 },
  defaultConfig: { claude: true, antigravity: true, showDone: "recent", sound: true },

  Component: ({ config }) => {
    useAgentFeed(config.sound);
    const { sessions, unread } = useAgents();
    const now = useNow();
    const visible = sessions.filter(
      (s) =>
        config[s.source] &&
        (s.state !== "done" || config.showDone === "all" || (config.showDone === "recent" && now - s.updated < RECENT_MS) || unread[s.id]),
    );
    const ringing = visible.filter((s) => unread[s.id]).length;
    const working = visible.filter((s) => s.state !== "done").length;
    const ack = (id?: string) =>
      useAgents.setState((s) => {
        if (!id) return { unread: {} };
        const { [id]: _, ...rest } = s.unread;
        return { unread: rest };
      });

    return (
      <div className="flex h-full flex-col gap-1.5 p-1">
        <div className="flex items-center justify-between gap-2">
          <span className="pd-caption min-w-0">agents · {working ? tr(`${working} đang chạy`, `${working} running`) : tr("rảnh", "idle")}</span>
          <button
            className={clsx("pd-bell", ringing > 0 && "pd-bell-ringing")}
            title={ringing ? tr("Đã xem — tắt chuông", "Seen — silence the bell") : tr("Chưa có session nào xong", "Nothing finished yet")}
            onClick={() => ack()}
          >
            {ringing ? <BellRing size={15} /> : <Bell size={15} />}
            {ringing > 0 && <span className="pd-bell-badge">{ringing}</span>}
          </button>
        </div>
        <div className="pd-box-body -mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
          {visible.map((s) => {
            const src = SOURCES[s.source];
            return (
              <button key={s.id} className={clsx("pd-agent", unread[s.id] && "pd-agent-done")} onClick={() => ack(s.id)} title={`${src.name} · ${s.project}\n${s.title}`}>
                <span className="pd-agent-src" style={{ background: src.color }}>{src.short}</span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[12.5px] text-[var(--pd-strong)]">{s.title}</span>
                  <span className="pd-muted block truncate text-[10.5px]">{src.name}{s.project && ` · ${s.project}`}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <StateBadge state={s.state} />
                  <span className="pd-muted text-[10px] tabular-nums">{ago(now - s.updated)}</span>
                </span>
              </button>
            );
          })}
          {visible.length === 0 && (
            <div className="pd-muted grid flex-1 place-items-center px-2 text-center text-xs">
              {tr("Chưa có session nào gần đây. Mở Claude Code hoặc Antigravity rồi giao việc nhé.", "No recent sessions. Start a task in Claude Code or Antigravity.")}
            </div>
          )}
        </div>
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Toggle label="Claude Code" checked={config.claude} onChange={(claude) => setConfig({ claude })} />
      <Toggle label="Antigravity" checked={config.antigravity} onChange={(antigravity) => setConfig({ antigravity })} />
      <Field label={tr("Session đã xong", "Finished sessions")}>
        <Segmented value={config.showDone} onChange={(showDone) => setConfig({ showDone })}
          options={[
            { value: "recent", label: tr("1 giờ qua", "Last hour") },
            { value: "all", label: tr("Tất cả (6 giờ)", "All (6 h)") },
            { value: "none", label: tr("Ẩn", "Hide") },
          ]} />
      </Field>
      <Toggle label={tr("Âm báo khi xong", "Chime when done")} checked={config.sound} onChange={(sound) => setConfig({ sound })} />
      <p className="pd-muted text-[11.5px] leading-relaxed">
        {tr(
          "Thông báo Windows bật/tắt trong Cài đặt PieDesk. Dữ liệu đọc tại chỗ từ ~/.claude/projects và ~/.gemini/antigravity — không gửi đi đâu.",
          "Windows notifications are toggled in PieDesk Settings. Data is read locally from ~/.claude/projects and ~/.gemini/antigravity — nothing leaves your PC.",
        )}
      </p>
    </>
  ),
});

function StateBadge({ state }: { state: Session["state"] }) {
  if (state === "working")
    return (
      <span className="pd-state pd-state-working">
        <Loader2 size={10} className="animate-spin" />
        {tr("đang chạy", "working")}
      </span>
    );
  if (state === "waiting")
    return (
      <span className="pd-state pd-state-waiting" title={tr("Không có hoạt động mới — có thể đang chờ bạn duyệt", "No new activity — may be waiting for your approval")}>
        <Hourglass size={10} />
        {tr("đang chờ", "waiting")}
      </span>
    );
  return (
    <span className="pd-state pd-state-done">
      <Check size={10} />
      {tr("xong", "done")}
    </span>
  );
}
