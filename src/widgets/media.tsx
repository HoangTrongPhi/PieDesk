import { useEffect, useState } from "react";
import { Code2, Image as ImageIcon, Timer } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { fileUrl, ipc } from "../lib/ipc";
import { Field, Segmented } from "./fields";
import { useNow } from "./hooks";
import { defineWidget } from "./types";
import { tr } from "../lib/i18n";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"]);

type PhotoConfig = { source: "file" | "folder"; path: string; interval: number; fit: "cover" | "contain" };

export const photo = defineWidget<PhotoConfig>({
  type: "photo",
  name: ["Khung ảnh", "Photo frame"],
  description: ["Một ảnh, hoặc trình chiếu ảnh trong một thư mục.", "One picture, or a slideshow of a folder."],
  icon: ImageIcon,
  defaultSize: { w: 280, h: 200 },
  minSize: { w: 100, h: 80 },
  defaultConfig: { source: "file", path: "", interval: 15, fit: "cover" },

  Component: ({ config }) => {
    const [list, setList] = useState<string[]>([]);
    const [i, setI] = useState(0);
    useEffect(() => {
      if (config.source !== "folder" || !config.path) return;
      ipc.listFolder(config.path).then((es) => setList(es.filter((e) => IMAGE_EXT.has(e.ext)).map((e) => e.path))).catch(() => setList([]));
    }, [config.source, config.path]);
    useEffect(() => {
      if (config.source !== "folder" || list.length < 2) return;
      const t = setInterval(() => setI((n) => n + 1), Math.max(3, config.interval) * 1000);
      return () => clearInterval(t);
    }, [config.source, config.interval, list.length]);

    const src = config.source === "file" ? config.path : list[i % Math.max(1, list.length)];
    if (!src) return <div className="grid h-full place-items-center text-xs text-white/50">{tr("Mở cài đặt ⚙ để chọn ảnh", "Open settings ⚙ to pick a picture")}</div>;
    return <img key={src} src={fileUrl(src)} className="pd-fade h-full w-full rounded-lg" style={{ objectFit: config.fit }} draggable={false} alt="" />;
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Segmented value={config.source} onChange={(source) => setConfig({ source, path: "" })}
        options={[{ value: "file", label: tr("Một ảnh", "One picture") }, { value: "folder", label: tr("Thư mục (trình chiếu)", "Folder (slideshow)") }]} />
      <Field label={config.source === "file" ? tr("Ảnh", "Picture") : tr("Thư mục", "Folder")}>
        <div className="flex gap-2">
          <input className="pd-input flex-1" value={config.path} readOnly />
          <button type="button" className="pd-btn" onClick={async () => {
            const p = config.source === "file"
              ? await openDialog({ filters: [{ name: tr("Ảnh", "Pictures"), extensions: [...IMAGE_EXT] }] })
              : await openDialog({ directory: true });
            if (typeof p === "string") setConfig({ path: p });
          }}>{tr("Chọn…", "Browse…")}</button>
        </div>
      </Field>
      {config.source === "folder" && (
        <Field label={tr(`Đổi ảnh sau ${config.interval} giây`, `Next picture after ${config.interval} s`)}>
          <input type="range" min={3} max={120} value={config.interval} onChange={(e) => setConfig({ interval: Number(e.target.value) })} />
        </Field>
      )}
      <Segmented value={config.fit} onChange={(fit) => setConfig({ fit })}
        options={[{ value: "cover", label: tr("Lấp đầy", "Fill") }, { value: "contain", label: tr("Vừa khung", "Fit") }]} />
    </>
  ),
});

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
