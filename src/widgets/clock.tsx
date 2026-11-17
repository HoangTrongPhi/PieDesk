import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Clock3, Search } from "lucide-react";
import { Field, Segmented, Toggle } from "./fields";
import { useNow } from "./hooks";
import { defineWidget } from "./types";
import { locale, tr } from "../lib/i18n";

type Config = { mode: "digital" | "analog"; tz: string; seconds: boolean; showDate: boolean; label: string };

/**
 * The zone if the browser knows it, else "" (the system time). A half-typed or unknown name used
 * to throw a RangeError while rendering, which took the whole desktop surface down.
 */
export function safeZone(tz: string): string {
  if (!tz) return "";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "";
  }
}

const zoned = (t: number, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeZone(tz) || undefined,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(t);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return { h: get("hour"), m: get("minute"), s: get("second") };
};

export default defineWidget<Config>({
  type: "clock",
  name: ["Đồng hồ", "Clock"],
  description: ["Đồng hồ số hoặc kim, nhiều múi giờ.", "Digital or analog clock, any time zone."],
  icon: Clock3,
  defaultSize: { w: 240, h: 120 },
  minSize: { w: 120, h: 80 },
  defaultConfig: { mode: "digital", tz: "", seconds: false, showDate: true, label: "" },

  Component: ({ config, size }) => {
    const now = useNow();
    const { h, m, s } = zoned(now, config.tz);
    const date = new Intl.DateTimeFormat(locale(), {
      timeZone: safeZone(config.tz) || undefined,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(now);

    if (config.mode === "analog") {
      const d = Math.min(size.w, size.h) - 24;
      const hand = (deg: number, len: number, w: number, color: string) => (
        <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)}
          stroke={color} strokeWidth={w} strokeLinecap="round" />
      );
      return (
        <div className="grid h-full place-items-center">
          <svg width={d} height={d} viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="47" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.15)" />
            {Array.from({ length: 12 }, (_, i) => (
              <line key={i} x1="50" y1="7" x2="50" y2={i % 3 ? 11 : 14} stroke="rgba(255,255,255,0.5)" strokeWidth={i % 3 ? 1 : 2}
                transform={`rotate(${i * 30} 50 50)`} />
            ))}
            {hand((h % 12) * 30 + m / 2, 24, 3.5, "#fff")}
            {hand(m * 6 + s / 10, 34, 2.2, "#dfe6ff")}
            {config.seconds && hand(s * 6, 38, 1, "var(--pd-accent)")}
            <circle cx="50" cy="50" r="2.5" fill="var(--pd-accent)" />
          </svg>
        </div>
      );
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const fs = Math.min(size.h * 0.45, size.w / (config.seconds ? 4.6 : 3.2));
    return (
      <div className="flex h-full flex-col items-center justify-center leading-none">
        {config.label && <div className="mb-1 text-[11px] tracking-wider text-white/50 uppercase">{config.label}</div>}
        <div className="font-light tabular-nums" style={{ fontSize: fs }}>
          {pad(h)}:{pad(m)}
          {config.seconds && <span className="text-white/50">:{pad(s)}</span>}
        </div>
        {config.showDate && <div className="mt-2 text-xs text-white/60 capitalize">{date}</div>}
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Field label={tr("Kiểu", "Style")}>
        <Segmented value={config.mode} onChange={(mode) => setConfig({ mode })}
          options={[{ value: "digital", label: tr("Số", "Digital") }, { value: "analog", label: tr("Kim", "Analog") }]} />
      </Field>
      <Field label={tr("Múi giờ", "Time zone")}>
        <ZonePicker value={safeZone(config.tz)} onPick={(tz) => setConfig({ tz })} />
      </Field>
      <Field label={tr("Nhãn", "Label")}>
        <input className="pd-input" value={config.label} onChange={(e) => setConfig({ label: e.target.value })} />
      </Field>
      <Toggle label={tr("Hiện giây", "Show seconds")} checked={config.seconds} onChange={(seconds) => setConfig({ seconds })} />
      <Toggle label={tr("Hiện ngày", "Show date")} checked={config.showDate} onChange={(showDate) => setConfig({ showDate })} />
    </>
  ),
});

const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

/** "America/Argentina/Buenos_Aires" → { city: "Buenos Aires", region: "America / Argentina" }. */
const split = (z: string) => {
  const parts = z.split("/");
  return { city: parts[parts.length - 1].replace(/_/g, " "), region: parts.slice(0, -1).join(" / ") };
};

const offsetOf = (z: string, now: number) => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
};

/**
 * Pick a zone from a searchable list (city, region or "GMT+7"), instead of typing an IANA name
 * into a datalist: only real zones can be chosen, so the clock never gets a broken one.
 */
function ZonePicker({ value, onPick }: { value: string; onPick: (tz: string) => void }) {
  const [query, setQuery] = useState("");
  const now = useMemo(() => Date.now(), []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, " ");
    const list = ZONES.map((z) => ({ z, ...split(z), off: offsetOf(z, now) })).filter(
      (x) => !q || x.z.toLowerCase().replace(/_/g, " ").includes(q) || x.off.toLowerCase().includes(q) || x.city.toLowerCase().includes(q),
    );
    return list.slice(0, 120);
  }, [query, now]);
  const row = (key: string, label: string, sub: string, off: string, active: boolean, tz: string) => (
    <button key={key} type="button" onClick={() => onPick(tz)}
      className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/8", active && "bg-[var(--pd-accent)]/15")}>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="pd-muted block truncate text-[11px]">{sub}</span>}
      </span>
      <span className="pd-muted shrink-0 text-[11px] tabular-nums">{off}</span>
      {active && <Check size={13} className="shrink-0 text-[var(--pd-accent)]" />}
    </button>
  );
  const current = value ? split(value) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="pd-muted text-xs">
        {tr("Đang dùng: ", "In use: ")}
        <span className="text-[var(--pd-fg)]">{current ? `${current.city} (${offsetOf(value, now)})` : tr("giờ của máy", "this PC's time")}</span>
      </div>
      <label className="relative flex items-center">
        <Search size={13} className="pd-muted pointer-events-none absolute left-2.5" />
        <input className="pd-input w-full !pl-7" placeholder={tr("Tìm thành phố, vùng hoặc GMT+7…", "Search a city, region or GMT+7…")}
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="flex max-h-52 flex-col overflow-y-auto rounded-lg border border-white/8 p-1">
        {!query && row("", tr("Giờ của máy (mặc định)", "This PC's time (default)"), "", "", !value, "")}
        {shown.map((x) => row(x.z, x.city, x.region, x.off, x.z === value, x.z))}
        {shown.length === 0 && <div className="pd-muted p-2 text-xs">{tr("Không tìm thấy múi giờ.", "No matching time zone.")}</div>}
      </div>
    </div>
  );
}
