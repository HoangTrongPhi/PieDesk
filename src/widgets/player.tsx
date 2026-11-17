import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Clapperboard, Link2, Music2, Pause, Play, Repeat, Volume2, VolumeX, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { fileUrl, ipc } from "../lib/ipc";
import { tr } from "../lib/i18n";
import { WIDGET_DROP, type WidgetDrop } from "../surface/itemDrag";
import { Field, Segmented, Toggle } from "./fields";
import { defineWidget } from "./types";

// "Khung ảnh" grew into a small media frame: a picture or a slideshow, a video, a song, or a
// YouTube video in a mini player. Drop a file from Explorer or a YouTube link from the browser on
// it, or paste a link (Ctrl+V). The widget type stays "photo" so existing frames keep working.

export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "svg"]);
export const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "mkv", "ogv"]);
export const AUDIO_EXT = new Set(["mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "opus", "weba"]);

type Kind = "image" | "video" | "audio" | "folder" | "youtube" | "";
type PlayerConfig = {
  /** "file" | "folder" (older configs) | "youtube". */
  source: "file" | "folder" | "youtube";
  path: string;
  url: string;
  interval: number;
  fit: "cover" | "contain";
  muted: boolean;
  loop: boolean;
};

const ext = (p: string) => p.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
const fileKind = (p: string): Kind => (IMAGE_EXT.has(ext(p)) ? "image" : VIDEO_EXT.has(ext(p)) ? "video" : AUDIO_EXT.has(ext(p)) ? "audio" : "");
const fileName = (p: string) => p.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? p;

/** YouTube video / playlist from any common link shape. */
export function parseYouTube(raw: string): { id: string | null; list: string | null; start: number } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  const valid = (s: string | null | undefined) => (s && /^[\w-]{6,64}$/.test(s) ? s : null);
  let id: string | null = null;
  if (host === "youtu.be") id = valid(u.pathname.slice(1).split("/")[0]);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = u.pathname.split("/");
    if (first === "watch") id = valid(u.searchParams.get("v"));
    else if (["embed", "shorts", "live", "v"].includes(first)) id = valid(second);
  } else return null;
  const list = valid(u.searchParams.get("list"));
  if (!id && !list) return null;
  const t = u.searchParams.get("t") ?? u.searchParams.get("start") ?? "";
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  const start = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
  return { id, list, start };
}

function embedUrl(raw: string, muted: boolean, loop: boolean): string | null {
  const yt = parseYouTube(raw);
  if (!yt) return null;
  const q = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0", modestbranding: "1" });
  if (muted) q.set("mute", "1");
  if (yt.start) q.set("start", String(yt.start));
  if (yt.list) q.set("list", yt.list);
  if (loop && yt.id) {
    q.set("loop", "1");
    if (!yt.list) q.set("playlist", yt.id);
  }
  return `https://www.youtube.com/embed/${yt.id ?? "videoseries"}?${q}`;
}

function kindOf(c: PlayerConfig): Kind {
  if (c.source === "youtube") return c.url ? "youtube" : "";
  if (c.source === "folder") return c.path ? "folder" : "";
  return c.path ? fileKind(c.path) || "image" : "";
}

export const player = defineWidget<PlayerConfig>({
  type: "photo",
  name: ["Khung media", "Media frame"],
  description: [
    "Ảnh, trình chiếu, video, nhạc mp3 — hoặc thả link YouTube để xem trong cửa sổ mini.",
    "Pictures, slideshows, videos, mp3s — or drop a YouTube link to watch in a mini player.",
  ],
  icon: Clapperboard,
  defaultSize: { w: 320, h: 200 },
  minSize: { w: 120, h: 90 },
  acceptsDrop: true,
  defaultConfig: { source: "file", path: "", url: "", interval: 15, fit: "cover", muted: false, loop: true },

  Component: ({ config, setConfig, id }) => {
    const [hint, setHint] = useState<string | null>(null);
    const kind = kindOf(config);

    // What was dropped / pasted becomes the new content.
    const take = (paths: string[], url: string | null) => {
      const yt = url && parseYouTube(url);
      if (yt) return setConfig({ source: "youtube", url: url! });
      if (url) return flash(tr("Chỉ nhận link YouTube", "Only YouTube links"));
      const p = paths[0];
      if (!p) return;
      if (fileKind(p)) return setConfig({ source: "file", path: p });
      if (!/\.[^\\/]+$/.test(p)) return setConfig({ source: "folder", path: p }); // a folder: slideshow
      flash(tr("Định dạng chưa hỗ trợ", "Unsupported format"));
    };
    const timer = useRef<number>(0);
    const flash = (msg: string) => {
      setHint(msg);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setHint(null), 2200);
    };
    useEffect(() => {
      if (!id) return;
      const on = (e: Event) => {
        const d = (e as CustomEvent<WidgetDrop>).detail;
        if (d.id === id) take(d.paths, d.url);
      };
      window.addEventListener(WIDGET_DROP, on);
      return () => window.removeEventListener(WIDGET_DROP, on);
    });

    const onPaste = (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text").trim();
      if (!text) return;
      e.preventDefault();
      if (/^https?:\/\//.test(text)) take([], text);
      else take([text.replace(/^"|"$/g, "")], null);
    };

    return (
      <div className="pd-player relative h-full w-full outline-none" tabIndex={0} onPaste={onPaste}>
        {kind === "" ? (
          <Empty onUrl={(u) => take([], u)} />
        ) : kind === "youtube" ? (
          <YouTube url={config.url} muted={config.muted} loop={config.loop} />
        ) : kind === "video" ? (
          <video key={config.path} src={fileUrl(config.path)} className="h-full w-full rounded-lg bg-black/40" style={{ objectFit: config.fit }}
            autoPlay muted={config.muted} loop={config.loop} controls playsInline />
        ) : kind === "audio" ? (
          <Audio path={config.path} loop={config.loop} muted={config.muted} />
        ) : (
          <Pictures config={config} />
        )}
        {kind !== "" && (
          <button className="pd-player-clear" title={tr("Bỏ nội dung (thả cái khác vào)", "Clear (drop something else)")}
            onClick={() => setConfig({ source: "file", path: "", url: "" })}>
            <X size={12} />
          </button>
        )}
        {hint && <div className="pd-player-hint">{hint}</div>}
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Segmented value={config.source} onChange={(source) => setConfig({ source })}
        options={[
          { value: "file", label: tr("File", "File") },
          { value: "folder", label: tr("Thư mục ảnh", "Picture folder") },
          { value: "youtube", label: "YouTube" },
        ]} />
      {config.source === "youtube" ? (
        <Field label={tr("Link YouTube", "YouTube link")} hint={tr("Video, Shorts, live hoặc playlist.", "A video, Short, live stream or playlist.")}>
          <input className="pd-input" placeholder="https://www.youtube.com/watch?v=…" value={config.url} onChange={(e) => setConfig({ url: e.target.value.trim() })} />
        </Field>
      ) : (
        <Field label={config.source === "file" ? tr("Ảnh, video hoặc nhạc", "Picture, video or music") : tr("Thư mục", "Folder")}>
          <div className="flex gap-2">
            <input className="pd-input flex-1" value={config.path} readOnly />
            <button type="button" className="pd-btn" onClick={async () => {
              const p = config.source === "file"
                ? await openDialog({ filters: [{ name: tr("Media", "Media"), extensions: [...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT] }] })
                : await openDialog({ directory: true });
              if (typeof p === "string") setConfig({ path: p });
            }}>{tr("Chọn…", "Browse…")}</button>
          </div>
        </Field>
      )}
      {config.source === "folder" && (
        <Field label={tr(`Đổi ảnh sau ${config.interval} giây`, `Next picture after ${config.interval} s`)}>
          <input type="range" min={3} max={120} value={config.interval} onChange={(e) => setConfig({ interval: Number(e.target.value) })} />
        </Field>
      )}
      {config.source !== "youtube" && (
        <Segmented value={config.fit} onChange={(fit) => setConfig({ fit })}
          options={[{ value: "cover", label: tr("Lấp đầy", "Fill") }, { value: "contain", label: tr("Vừa khung", "Fit") }]} />
      )}
      <Toggle label={tr("Tắt tiếng khi bắt đầu", "Start muted")} checked={config.muted} onChange={(muted) => setConfig({ muted })} />
      <Toggle label={tr("Phát lặp lại", "Loop")} checked={config.loop} onChange={(loop) => setConfig({ loop })} />
      <p className="pd-muted text-[11.5px] leading-relaxed">
        {tr("Mẹo: kéo thả file ảnh / mp3 / mp4 từ Explorer hoặc link YouTube từ trình duyệt thẳng vào widget, hoặc bấm vào widget rồi Ctrl+V.",
          "Tip: drag a picture / mp3 / mp4 from Explorer or a YouTube link from your browser onto the widget, or click it and press Ctrl+V.")}
      </p>
    </>
  ),
});

function Empty({ onUrl }: { onUrl: (url: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
      <div className="flex gap-2 text-white/45"><Clapperboard size={18} /><Music2 size={18} /><Link2 size={18} /></div>
      <div className="text-[11.5px] leading-snug text-white/55">
        {tr("Thả ảnh, mp3, mp4 hoặc link YouTube vào đây", "Drop a picture, mp3, mp4 or YouTube link here")}
      </div>
      <form className="flex w-full max-w-60 gap-1" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onUrl(v.trim()); }}>
        <input className="pd-input min-w-0 flex-1 !py-1 text-[11px]" placeholder={tr("…hoặc dán link YouTube", "…or paste a YouTube link")} value={v} onChange={(e) => setV(e.target.value)} />
        <button className="pd-btn !px-2 !py-1" type="submit"><Play size={12} /></button>
      </form>
    </div>
  );
}

function YouTube({ url, muted, loop }: { url: string; muted: boolean; loop: boolean }) {
  const src = embedUrl(url, muted, loop);
  if (!src) return <div className="grid h-full place-items-center text-xs text-white/50">{tr("Link YouTube không hợp lệ", "Not a valid YouTube link")}</div>;
  return (
    <iframe key={src} src={src} title="YouTube" className="h-full w-full rounded-lg border-0 bg-black"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
  );
}

function Pictures({ config }: { config: PlayerConfig }) {
  const [list, setList] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const folder = config.source === "folder";
  useEffect(() => {
    if (!folder || !config.path) return;
    ipc.listFolder(config.path).then((es) => setList(es.filter((e) => IMAGE_EXT.has(e.ext)).map((e) => e.path))).catch(() => setList([]));
  }, [folder, config.path]);
  useEffect(() => {
    if (!folder || list.length < 2) return;
    const t = setInterval(() => setI((n) => n + 1), Math.max(3, config.interval) * 1000);
    return () => clearInterval(t);
  }, [folder, config.interval, list.length]);
  const src = folder ? list[i % Math.max(1, list.length)] : config.path;
  if (!src) return <div className="grid h-full place-items-center text-xs text-white/50">{tr("Thư mục không có ảnh", "No pictures in this folder")}</div>;
  return <img key={src} src={fileUrl(src)} className="pd-fade h-full w-full rounded-lg" style={{ objectFit: config.fit }} draggable={false} alt="" />;
}

const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

/** A song: big play button, title, seek bar and a little equaliser while it plays. */
function Audio({ path, loop, muted }: { path: string; loop: boolean; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [mute, setMute] = useState(muted);
  const [repeat, setRepeat] = useState(loop);
  useEffect(() => setMute(muted), [muted]);
  useEffect(() => setRepeat(loop), [loop]);
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-2">
      <audio ref={ref} src={fileUrl(path)} loop={repeat} muted={mute} autoPlay
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />
      <div className="flex items-center gap-3">
        <button className="pd-player-play" onClick={toggle} title={playing ? tr("Tạm dừng", "Pause") : tr("Phát", "Play")}>
          {playing ? <Pause size={18} /> : <Play size={18} className="translate-x-[1px]" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[var(--pd-strong)]" title={path}>{fileName(path)}</div>
          <div className="pd-muted flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider">
            <Music2 size={10} /> {ext(path)}
            <span className={clsx("pd-eq", playing && "pd-eq-on")}><i /><i /><i /><i /></span>
          </div>
        </div>
        <button className={clsx("pd-icon-btn", repeat && "text-[var(--pd-accent)]")} title={tr("Lặp lại", "Loop")} onClick={() => setRepeat(!repeat)}><Repeat size={13} /></button>
        <button className="pd-icon-btn" title={mute ? tr("Bật tiếng", "Unmute") : tr("Tắt tiếng", "Mute")} onClick={() => setMute(!mute)}>
          {mute ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
      </div>
      <div className="flex items-center gap-2 text-[10px] tabular-nums text-white/55">
        <span>{mmss(t)}</span>
        <input type="range" className="pd-player-seek flex-1" min={0} max={dur || 0} step={0.1} value={t}
          onChange={(e) => { if (ref.current) ref.current.currentTime = Number(e.target.value); }} />
        <span>{mmss(dur)}</span>
      </div>
    </div>
  );
}

