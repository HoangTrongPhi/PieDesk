import { useEffect, useState } from "react";
import { Code2, Timer } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { fileUrl, ipc } from "../lib/ipc";
import { Field } from "./fields";
import { useNow } from "./hooks";
import { defineWidget } from "./types";
import { tr } from "../lib/i18n";

type CountdownConfig = { label: string; target: string };

export const countdown = defineWidget<CountdownConfig>({
  type: "countdown",
  name: ["Đếm ngược", "Countdown"],
  description: ["Đếm ngược tới một ngày (deadline, sự kiện…).", "Count down to a date (deadline, event…)."],
  icon: Timer,
  defaultSize: { w: 260, h: 120 },
  minSize: { w: 180, h: 90 },
  defaultConfig: { label: "Tết", target: `${new Date().getFullYear() + 1}-02-17T00:00` },

  Component: ({ config }) => {
    const now = useNow();
    const diff = Math.max(0, new Date(config.target).getTime() - now);
    const parts = [
      [Math.floor(diff / 86400000), tr("ngày", "days")],
      [Math.floor(diff / 3600000) % 24, tr("giờ", "hrs")],
      [Math.floor(diff / 60000) % 60, tr("phút", "min")],
      [Math.floor(diff / 1000) % 60, tr("giây", "sec")],
    ] as const;
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="mb-2 text-xs tracking-wider text-white/55 uppercase">{config.label}</div>
        <div className="flex gap-3">
          {parts.map(([v, u]) => (
            <div key={u} className="text-center">
              <div className="text-2xl font-light tabular-nums">{String(v).padStart(2, "0")}</div>
              <div className="text-[10px] text-white/45">{u}</div>
            </div>
          ))}
        </div>
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Field label={tr("Tên sự kiện", "Event name")}>
        <input className="pd-input" value={config.label} onChange={(e) => setConfig({ label: e.target.value })} />
      </Field>
      <Field label={tr("Thời điểm", "When")}>
        <input type="datetime-local" className="pd-input" value={config.target} onChange={(e) => setConfig({ target: e.target.value })} />
      </Field>
    </>
  ),
});

type WebConfig = { path: string };

/**
 * Custom widget: a local HTML file in a sandboxed iframe. It can ask for system data with
 * `parent.postMessage({ piedesk: "subscribe", topic: "cpu" }, "*")` and receives
 * `{ piedesk: "data", topic, payload }` messages.
 */
export const web = defineWidget<WebConfig>({
  type: "web",
  name: ["Web widget (tự viết)", "Web widget (your own)"],
  description: ["Widget HTML/JS của riêng bạn, chạy sandbox, đọc được CPU/RAM/mạng qua postMessage.", "Your own sandboxed HTML/JS widget; reads CPU/RAM/network via postMessage."],
  icon: Code2,
  defaultSize: { w: 300, h: 220 },
  minSize: { w: 100, h: 60 },
  defaultConfig: { path: "" },

  Component: ({ config }) => {
    const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
    useEffect(() => {
      if (!frame) return;
      const topics = new Set<string>();
      const unlisten: Promise<() => void>[] = [];
      const onMessage = (e: MessageEvent) => {
        if (e.source !== frame.contentWindow || e.data?.piedesk !== "subscribe") return;
        const topic = String(e.data.topic);
        if (topics.has(topic)) return;
        topics.add(topic);
        ipc.hubSubscribe(topic).catch(() => {});
        unlisten.push(listen(`hub://${topic}`, ({ payload }) =>
          frame.contentWindow?.postMessage({ piedesk: "data", topic, payload }, "*")));
      };
      window.addEventListener("message", onMessage);
      return () => {
        window.removeEventListener("message", onMessage);
        topics.forEach((t) => ipc.hubUnsubscribe(t).catch(() => {}));
        unlisten.forEach((u) => u.then((f) => f()));
      };
    }, [frame]);

    if (!config.path) return <div className="grid h-full place-items-center px-3 text-center text-xs text-white/50">{tr("Mở cài đặt ⚙ để chọn file index.html của widget", "Open settings ⚙ to pick the widget’s index.html")}</div>;
    return <iframe ref={setFrame} src={fileUrl(config.path)} sandbox="allow-scripts" className="h-full w-full rounded-lg border-0" title="web widget" />;
  },

  Settings: ({ config, setConfig }) => (
    <Field label="File HTML" hint='API: parent.postMessage({ piedesk: "subscribe", topic: "cpu" | "mem" | "net" | "disk" }, "*")'>
      <div className="flex gap-2">
        <input className="pd-input flex-1" value={config.path} readOnly />
        <button type="button" className="pd-btn" onClick={async () => {
          const p = await openDialog({ filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
          if (typeof p === "string") setConfig({ path: p });
        }}>{tr("Chọn…", "Browse…")}</button>
      </div>
    </Field>
  ),
});
