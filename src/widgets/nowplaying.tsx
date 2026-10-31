import { useEffect, useState } from "react";
import clsx from "clsx";
import { Music2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { tr } from "../lib/i18n";
import { ipc } from "../lib/ipc";
import { Toggle } from "./fields";
import { useHub, useNow } from "./hooks";
import { defineWidget } from "./types";

// What Windows shows in its media flyout (read by src-tauri/src/media.rs): Spotify, browsers,
// players. Rust only sends changes; the progress bar runs here from `position` + `updated`.

type NowPlaying = {
  app: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  position: number;
  duration: number;
  updated: number;
  canPrev: boolean;
  canNext: boolean;
  art: number;
  artType: string;
};
type Config = { backdrop: boolean; progress: boolean };

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};

/** Object URL of the current cover, fetched once per cover id. */
function useArt(id: number | undefined, type: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return setUrl(null);
    let made: string | null = null;
    let live = true;
    ipc.mediaArt().then((buf) => {
      if (!live || !(buf instanceof ArrayBuffer) || !buf.byteLength) return;
      made = URL.createObjectURL(new Blob([buf], { type: type || "image/jpeg" }));
      setUrl(made);
    }).catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, type]);
  return url;
}

export default defineWidget<Config>({
  type: "nowplaying",
  name: ["Đang phát", "Now Playing"],
  description: ["Bài đang phát trên Spotify, trình duyệt, trình nghe nhạc… kèm ảnh bìa và nút điều khiển.", "What Spotify, your browser or player is playing, with cover art and controls."],
  icon: Music2,
  defaultSize: { w: 320, h: 130 },
  minSize: { w: 200, h: 80 },
  defaultConfig: { backdrop: true, progress: true },

  Component: ({ config, size }) => {
    const np = useHub<NowPlaying | null>("media");
    const art = useArt(np?.art, np?.artType);
    const now = useNow();
    const [busy, setBusy] = useState(false);

    if (!np) {
      return (
        <div className="flex h-full items-center justify-center gap-2 text-xs text-white/50">
          <Music2 size={16} /> {tr("Không có gì đang phát", "Nothing playing")}
        </div>
      );
    }

    const pos = np.duration ? Math.min(np.duration, np.position + (np.playing && np.updated ? Math.max(0, now - np.updated) : 0)) : 0;
    const compact = size.h < 110;
    const cover = Math.max(48, Math.min(size.h - 16, size.w * 0.38, 160));
    const act = (a: "toggle" | "next" | "prev") => {
      setBusy(true);
      ipc.mediaControl(a).catch(() => {}).finally(() => setBusy(false));
    };

    return (
      <div className="relative flex h-full gap-3 overflow-hidden rounded-lg p-1">
        {config.backdrop && art && (
          <img src={art} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-2xl" />
        )}
        <div className="relative shrink-0 overflow-hidden rounded-md bg-white/5" style={{ width: cover, height: cover }}>
          {art ? <img key={art} src={art} alt="" draggable={false} className="pd-fade h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-white/30"><Music2 size={cover / 3} /></div>}
        </div>
        <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--pd-accent)]">{np.app}</div>
          <div className="truncate text-sm font-semibold" title={np.title}>{np.title}</div>
          {np.artist && <div className="truncate text-xs text-white/60" title={np.album || undefined}>{np.artist}</div>}
          {config.progress && np.duration > 0 && !compact && (
            <div className="mt-1">
              <div className="h-1 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-[var(--pd-accent)] transition-[width] duration-1000 ease-linear" style={{ width: `${(pos / np.duration) * 100}%` }} />
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-white/45">
                <span>{clock(pos)}</span>
                <span>{clock(np.duration)}</span>
              </div>
            </div>
          )}
          <div className={clsx("flex items-center gap-1", compact ? "mt-0.5" : "mt-1")}>
            <button className="pd-icon-btn" disabled={!np.canPrev || busy} onClick={() => act("prev")} title={tr("Bài trước", "Previous")}><SkipBack size={14} /></button>
            <button className="pd-icon-btn" disabled={busy} onClick={() => act("toggle")} title={np.playing ? tr("Tạm dừng", "Pause") : tr("Phát", "Play")}>
              {np.playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="pd-icon-btn" disabled={!np.canNext || busy} onClick={() => act("next")} title={tr("Bài sau", "Next")}><SkipForward size={14} /></button>
          </div>
        </div>
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Toggle label={tr("Nền mờ theo ảnh bìa", "Blurred cover backdrop")} checked={config.backdrop} onChange={(backdrop) => setConfig({ backdrop })} />
      <Toggle label={tr("Thanh tiến trình (khi app có báo)", "Progress bar (when the app reports it)")} checked={config.progress} onChange={(progress) => setConfig({ progress })} />
    </>
  ),
});
