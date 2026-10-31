import { useState } from "react";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Segmented, Toggle } from "./fields";
import { useNow } from "./hooks";
import { defineWidget } from "./types";
import { locale, tr } from "../lib/i18n";
import { dayName, holidays, lunarOf, monthName, yearName } from "../lib/lunar";

type Config = { weekStart: "mon" | "sun"; lunar: boolean; holidays: boolean };

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default defineWidget<Config>({
  type: "calendar",
  name: ["Lịch", "Calendar"],
  description: ["Lịch tháng có âm lịch, can chi và ngày lễ Việt Nam.", "Month view with the Vietnamese lunar calendar and holidays."],
  icon: CalendarDays,
  defaultSize: { w: 280, h: 310 },
  minSize: { w: 200, h: 200 },
  defaultConfig: { weekStart: "mon", lunar: true, holidays: true },

  Component: ({ config }) => {
    const now = new Date(useNow());
    const [offset, setOffset] = useState(0);
    const [picked, setPicked] = useState<Date | null>(null);
    const lunarOn = config.lunar !== false;
    const holidaysOn = config.holidays !== false;
    const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const startDow = config.weekStart === "mon" ? (view.getDay() + 6) % 7 : view.getDay();
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    // 2024-01-07 was a Sunday: format a week from there in the current language.
    const sunday = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale(), { weekday: "narrow" }));
    const names = config.weekStart === "mon" ? [...sunday.slice(1), sunday[0]] : sunday;
    const cells = [...Array<null>(startDow).fill(null), ...Array.from({ length: days }, (_, i) => new Date(view.getFullYear(), view.getMonth(), i + 1))];
    const sundayCol = config.weekStart === "mon" ? 6 : 0;

    const focus = picked ?? now;
    const fl = lunarOf(focus);
    const fh = holidaysOn ? holidays(focus, fl) : [];

    return (
      <div className="flex h-full flex-col p-1 text-xs">
        <div className="mb-1.5 flex items-center justify-between">
          <button className="pd-icon-btn" onClick={() => setOffset(offset - 1)}><ChevronLeft size={14} /></button>
          <button className="text-sm font-semibold capitalize" onClick={() => { setOffset(0); setPicked(null); }}>
            {view.toLocaleDateString(locale(), { month: "long", year: "numeric" })}
          </button>
          <button className="pd-icon-btn" onClick={() => setOffset(offset + 1)}><ChevronRight size={14} /></button>
        </div>
        <div className="grid grid-cols-7 text-center">
          {names.map((n, i) => <div key={i} className="pb-1 text-[10px] font-semibold text-white/40">{n}</div>)}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-0.5 text-center">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const l = lunarOn ? lunarOf(d) : null;
            const hol = holidaysOn ? holidays(d, l ?? undefined) : [];
            const today = sameDay(d, now);
            const sel = picked && sameDay(d, picked);
            return (
              <button key={i} title={hol.join(" · ") || undefined} onClick={() => setPicked(sel ? null : d)}
                className={clsx("relative flex min-h-0 flex-col items-center justify-center rounded-lg leading-none tabular-nums",
                  today ? "bg-[var(--pd-accent)] font-semibold text-white" : sel ? "bg-white/15" : "hover:bg-white/8",
                  !today && (hol.length ? "text-amber-300" : i % 7 === sundayCol && "text-rose-300/80"))}>
                <span>{d.getDate()}</span>
                {l && (
                  <span className={clsx("mt-0.5 text-[9px]", today ? "text-white/80" : l.day === 1 || l.day === 15 ? "text-[var(--pd-accent)]" : "text-white/40")}>
                    {l.day === 1 ? `${l.day}/${l.month}${l.leap ? "n" : ""}` : l.day}
                  </span>
                )}
                {hol.length > 0 && !today && <span className="absolute right-1 top-1 size-1 rounded-full bg-amber-300" />}
              </button>
            );
          })}
        </div>
        {(lunarOn || fh.length > 0) && (
          <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] leading-snug">
            {lunarOn && (
              <div className="truncate text-white/75">
                <span className="font-semibold text-white">{tr("Âm", "Lunar")} {fl.day}/{fl.month}{fl.leap ? tr(" (nhuận)", " (leap)") : ""}</span>
                {" · "}{tr("năm", "year")} {yearName(fl.year)}
              </div>
            )}
            {lunarOn && (
              <div className="truncate text-white/45">
                {tr("Ngày", "Day")} {dayName(fl.jd)} · {tr("tháng", "month")} {monthName(fl.month, fl.year)}
              </div>
            )}
            {fh.length > 0 && <div className="truncate font-medium text-amber-300">{fh.join(" · ")}</div>}
          </div>
        )}
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Segmented value={config.weekStart} onChange={(weekStart) => setConfig({ weekStart })}
        options={[{ value: "mon", label: tr("Bắt đầu thứ Hai", "Week starts Monday") }, { value: "sun", label: tr("Bắt đầu Chủ nhật", "Week starts Sunday") }]} />
      <Toggle label={tr("Hiện âm lịch và can chi", "Show the lunar calendar")} checked={config.lunar !== false} onChange={(lunar) => setConfig({ lunar })} />
      <Toggle label={tr("Đánh dấu ngày lễ", "Mark holidays")} checked={config.holidays !== false} onChange={(holidays) => setConfig({ holidays })} />
    </>
  ),
});
