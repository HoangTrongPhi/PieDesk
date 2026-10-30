import { Clock3 } from "lucide-react";
import { Field, Segmented, Toggle } from "./fields";
import { useNow } from "./hooks";
import { defineWidget } from "./types";
import { locale, tr } from "../lib/i18n";

type Config = { mode: "digital" | "analog"; tz: string; seconds: boolean; showDate: boolean; label: string };

const zoned = (t: number, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz || undefined,
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
      timeZone: config.tz || undefined,
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
      <Field label={tr("Múi giờ (IANA)", "Time zone (IANA)")} hint={tr("Để trống = giờ máy. Ví dụ: Asia/Tokyo, Europe/London", "Empty = system time. e.g. Asia/Tokyo, Europe/London")}>
        <input className="pd-input" value={config.tz} onChange={(e) => setConfig({ tz: e.target.value.trim() })} list="pd-tz" />
      </Field>
      <datalist id="pd-tz">
        {Intl.supportedValuesOf("timeZone").map((z) => <option key={z} value={z} />)}
      </datalist>
      <Field label={tr("Nhãn", "Label")}>
        <input className="pd-input" value={config.label} onChange={(e) => setConfig({ label: e.target.value })} />
      </Field>
      <Toggle label={tr("Hiện giây", "Show seconds")} checked={config.seconds} onChange={(seconds) => setConfig({ seconds })} />
      <Toggle label={tr("Hiện ngày", "Show date")} checked={config.showDate} onChange={(showDate) => setConfig({ showDate })} />
    </>
  ),
});
