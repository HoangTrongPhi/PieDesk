import { useState } from "react";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Segmented } from "./fields";
import { useNow } from "./hooks";
import { defineWidget } from "./types";
import { locale, tr } from "../lib/i18n";

type Config = { weekStart: "mon" | "sun" };

export default defineWidget<Config>({
  type: "calendar",
  name: ["Lịch", "Calendar"],
  description: ["Lịch tháng, đánh dấu hôm nay.", "Month view with today highlighted."],
  icon: CalendarDays,
  defaultSize: { w: 260, h: 250 },
  minSize: { w: 200, h: 200 },
  defaultConfig: { weekStart: "mon" },

  Component: ({ config }) => {
    const now = new Date(useNow());
    const [offset, setOffset] = useState(0);
    const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const startDow = config.weekStart === "mon" ? (view.getDay() + 6) % 7 : view.getDay();
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    // 2024-01-07 was a Sunday: format a week from there in the current language.
    const sunday = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale(), { weekday: "narrow" }));
    const names = config.weekStart === "mon" ? [...sunday.slice(1), sunday[0]] : sunday;
    const cells = [...Array(startDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
    const isToday = (d: number) => offset === 0 && d === now.getDate();

    return (
      <div className="flex h-full flex-col p-1 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <button className="pd-icon-btn" onClick={() => setOffset(offset - 1)}><ChevronLeft size={14} /></button>
          <button className="text-sm font-semibold capitalize" onClick={() => setOffset(0)}>
            {view.toLocaleDateString(locale(), { month: "long", year: "numeric" })}
          </button>
          <button className="pd-icon-btn" onClick={() => setOffset(offset + 1)}><ChevronRight size={14} /></button>
        </div>
        <div className="grid flex-1 grid-cols-7 content-start gap-y-1 text-center">
          {names.map((n, i) => <div key={i} className="pb-1 text-[10px] font-semibold text-white/40">{n}</div>)}
          {cells.map((d, i) => (
            <div key={i} className={clsx("mx-auto grid size-7 place-items-center rounded-full tabular-nums",
              d && isToday(d) && "bg-[var(--pd-accent)] font-semibold text-white",
              d && !isToday(d) && (i % 7 === (config.weekStart === "mon" ? 6 : 0)) && "text-rose-300/80")}>
              {d ?? ""}
            </div>
          ))}
        </div>
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <Segmented value={config.weekStart} onChange={(weekStart) => setConfig({ weekStart })}
      options={[{ value: "mon", label: tr("Bắt đầu thứ Hai", "Week starts Monday") }, { value: "sun", label: tr("Bắt đầu Chủ nhật", "Week starts Sunday") }]} />
  ),
});
