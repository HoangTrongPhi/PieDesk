import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloudSun, Droplets, Search, Wind } from "lucide-react";
import { locale, tr } from "../lib/i18n";
import { Field, Segmented, Toggle } from "./fields";
import { defineWidget } from "./types";

// Neon weather station (after the HuangFei room portfolio): animated canvas icon, glowing
// temperature, 12-hour chart (temperature line + rain chance bars) and a few days ahead.
// Data: Open-Meteo, free and keyless — https://open-meteo.com

type Config = { city: string; lat: number; lon: number; unit: "celsius" | "fahrenheit"; animate: boolean; days: boolean };
type Forecast = {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    is_day: number;
    wind_speed_10m: number;
    relative_humidity_2m: number;
  };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
};
type IconKind = "sun" | "moon" | "sun-cloud" | "moon-cloud" | "cloud" | "fog" | "rain" | "snow" | "storm";

const REFRESH_MS = 15 * 60 * 1000;
const HOURS = 12;

function describe(code: number, day = true): { label: string; icon: IconKind } {
  if (code === 0) return { label: day ? tr("Trời quang", "Clear sky") : tr("Đêm quang", "Clear night"), icon: day ? "sun" : "moon" };
  if (code <= 2) return { label: tr("Ít mây", "Partly cloudy"), icon: day ? "sun-cloud" : "moon-cloud" };
  if (code === 3) return { label: tr("Nhiều mây", "Overcast"), icon: "cloud" };
  if (code <= 48) return { label: tr("Sương mù", "Foggy"), icon: "fog" };
  if (code <= 57) return { label: tr("Mưa phùn", "Drizzle"), icon: "rain" };
  if (code <= 67) return { label: tr("Mưa", "Rain"), icon: "rain" };
  if (code <= 77) return { label: tr("Tuyết", "Snow"), icon: "snow" };
  if (code <= 82) return { label: tr("Mưa rào", "Showers"), icon: "rain" };
  if (code <= 86) return { label: tr("Mưa tuyết", "Snow showers"), icon: "snow" };
  return { label: tr("Dông", "Thunderstorm"), icon: "storm" };
}

export default defineWidget<Config>({
  type: "weather",
  name: ["Thời tiết", "Weather"],
  description: [
    "Trạm thời tiết neon: icon động, biểu đồ 12 giờ, dự báo nhiều ngày (Open-Meteo, không cần API key).",
    "Neon weather station: animated icon, 12-hour chart, multi-day forecast (Open-Meteo, no API key).",
  ],
  icon: CloudSun,
  defaultSize: { w: 300, h: 250 },
  minSize: { w: 220, h: 120 },
  defaultConfig: { city: "Hà Nội", lat: 21.0285, lon: 105.8542, unit: "celsius", animate: true, days: true },

  Component: ({ config, size }) => {
    const [data, setData] = useState<Forecast | null>(null);
    const [offline, setOffline] = useState(false);

    useEffect(() => {
      let alive = true;
      const load = () => {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${config.lat}&longitude=${config.lon}` +
          `&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m` +
          `&hourly=temperature_2m,precipitation_probability&forecast_hours=${HOURS + 1}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=6&timezone=auto` +
          `&temperature_unit=${config.unit}&wind_speed_unit=${config.unit === "celsius" ? "kmh" : "mph"}`;
        fetch(url)
          .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
          .then((d: Forecast) => alive && (setData(d), setOffline(false)))
          .catch(() => alive && setOffline(true));
      };
      load();
      const t = setInterval(load, REFRESH_MS);
      // Back online after sleep / Wi-Fi drop: refresh right away instead of waiting 15 min.
      window.addEventListener("online", load);
      return () => {
        alive = false;
        clearInterval(t);
        window.removeEventListener("online", load);
      };
    }, [config.lat, config.lon, config.unit]);

    const head = (
      <div className="flex items-center justify-between gap-2">
        <span className="pd-caption min-w-0">weather · {config.city}</span>
        <span className={offline ? "pd-live pd-live-off" : "pd-live"}><i />{offline ? "offline" : "live"}</span>
      </div>
    );
    if (!data)
      return (
        <div className="flex h-full flex-col p-1">
          {head}
          <div className="pd-muted grid flex-1 place-items-center text-xs">{offline ? tr("Không tải được thời tiết", "Weather unavailable") : tr("Đang tải…", "Loading…")}</div>
        </div>
      );

    const cur = data.current;
    const { label, icon } = describe(cur.weather_code, cur.is_day === 1);
    const speed = config.unit === "celsius" ? "km/h" : "mph";
    const showChart = size.h >= 200;
    const showDays = config.days && size.h >= 300;
    const compact = size.h < 150;

    return (
      <div className="flex h-full flex-col gap-1.5 p-1">
        {head}
        <div className="flex items-center gap-2.5">
          <WeatherIcon kind={icon} size={compact ? 44 : 60} animate={config.animate} />
          <div className="min-w-0">
            <div className="pd-glow-text text-[34px] leading-none font-bold tabular-nums">{Math.round(cur.temperature_2m)}°</div>
            <div className="pd-muted mt-1 truncate text-xs">{label}</div>
          </div>
          {!compact && (
            <div className="pd-muted ml-auto text-right text-[11px] leading-relaxed tabular-nums">
              <div>{tr("Cảm giác", "Feels")} {Math.round(cur.apparent_temperature)}°</div>
              <div>H {Math.round(data.daily.temperature_2m_max[0])}° · L {Math.round(data.daily.temperature_2m_min[0])}°</div>
            </div>
          )}
        </div>
        <div className="pd-muted flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
          {compact && <span>H {Math.round(data.daily.temperature_2m_max[0])}° · L {Math.round(data.daily.temperature_2m_min[0])}°</span>}
          <span className="inline-flex items-center gap-1"><Droplets size={11} className="text-[#66e0ff]" />{cur.relative_humidity_2m}%</span>
          <span className="inline-flex items-center gap-1"><Wind size={11} />{Math.round(cur.wind_speed_10m)} {speed}</span>
          {data.hourly.precipitation_probability[1] > 0 && (
            <span>☂ {Math.max(...data.hourly.precipitation_probability.slice(0, HOURS))}%</span>
          )}
        </div>
        {showChart && (
          <HourChart
            times={data.hourly.time.slice(0, HOURS + 1)}
            temps={data.hourly.temperature_2m.slice(0, HOURS + 1)}
            rain={data.hourly.precipitation_probability.slice(0, HOURS + 1)}
          />
        )}
        {showDays && (
          <div className="mt-auto grid grid-cols-5 gap-1 text-center text-[11px]">
            {data.daily.time.slice(1, 6).map((t, i) => {
              const d = describe(data.daily.weather_code[i + 1]);
              return (
                <div key={t} className="rounded-lg bg-white/5 py-1" title={d.label}>
                  <div className="pd-muted capitalize">{new Date(t).toLocaleDateString(locale(), { weekday: "short" })}</div>
                  <WeatherIcon kind={d.icon} size={26} animate={false} />
                  <div className="tabular-nums">
                    {Math.round(data.daily.temperature_2m_max[i + 1])}° <span className="pd-muted">{Math.round(data.daily.temperature_2m_min[i + 1])}°</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },

  Settings: ({ config, setConfig }) => {
    const [q, setQ] = useState(config.city);
    const [results, setResults] = useState<{ name: string; country: string; admin1?: string; latitude: number; longitude: number }[]>([]);
    const search = () =>
      fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=${locale().slice(0, 2)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]));
    return (
      <>
        <Field label={tr("Thành phố", "City")}>
          <div className="flex gap-2">
            <input className="pd-input flex-1" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())} />
            <button type="button" className="pd-btn" onClick={search}><Search size={14} /></button>
          </div>
        </Field>
        {results.length > 0 && (
          <div className="flex flex-col gap-1">
            {results.map((r) => (
              <button key={`${r.latitude},${r.longitude}`} type="button" className="pd-menu-item rounded-md"
                onClick={() => {
                  setConfig({ city: r.name, lat: r.latitude, lon: r.longitude });
                  setResults([]);
                  setQ(r.name);
                }}>
                {r.name} <span className="pd-muted">{[r.admin1, r.country].filter(Boolean).join(", ")}</span>
              </button>
            ))}
          </div>
        )}
        <Segmented value={config.unit} onChange={(unit) => setConfig({ unit })}
          options={[{ value: "celsius", label: "°C · km/h" }, { value: "fahrenheit", label: "°F · mph" }]} />
        <Toggle label={tr("Icon chuyển động", "Animated icon")} checked={config.animate} onChange={(animate) => setConfig({ animate })} />
        <Toggle label={tr("Dự báo 5 ngày (khi widget đủ cao)", "5-day forecast (when tall enough)")} checked={config.days}
          onChange={(days) => setConfig({ days })} />
      </>
    );
  },
});

// ---------------------------------------------------------------------------------------------
// Animated icon: drawn on a canvas at ~30 fps, only while the surface is visible.

const ICON_FPS = 30;

function WeatherIcon({ kind, size, animate }: { kind: IconKind; size: number; animate: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const px = Math.round(size * devicePixelRatio);
    canvas.width = canvas.height = px;
    const draw = (t: number) => {
      ctx.setTransform(px / 128, 0, 0, px / 128, 0, 0);
      ctx.clearRect(0, 0, 128, 128);
      drawIcon(ctx, kind, t);
    };
    if (!animate) {
      draw(0.6);
      return;
    }
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / ICON_FPS - 1) return;
      last = now;
      draw(now / 1000);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [kind, size, animate]);
  return <canvas ref={ref} className="mx-auto shrink-0" style={{ width: size, height: size }} aria-hidden />;
}

function drawIcon(c: CanvasRenderingContext2D, kind: IconKind, t: number) {
  c.save();
  c.lineCap = "round";
  const disc = (x: number, y: number, r: number) => {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  };
  const sun = (x: number, y: number, r: number) => {
    c.shadowColor = "#ffd166";
    c.shadowBlur = 18;
    c.fillStyle = c.strokeStyle = "#ffd166";
    disc(x, y, r);
    c.lineWidth = 4;
    for (let i = 0; i < 8; i++) {
      const a = t * 0.6 + (i * Math.PI) / 4;
      const len = r * (0.45 + 0.12 * Math.sin(t * 3 + i));
      c.beginPath();
      c.moveTo(x + Math.cos(a) * (r + 7), y + Math.sin(a) * (r + 7));
      c.lineTo(x + Math.cos(a) * (r + 7 + len), y + Math.sin(a) * (r + 7 + len));
      c.stroke();
    }
  };
  const moon = (x: number, y: number, r: number) => {
    [[24, 30], [100, 24], [96, 92], [30, 96], [70, 16]].forEach(([sx, sy], i) => {
      c.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i));
      c.fillStyle = "#e8f6ff";
      disc(sx, sy, 2);
    });
    c.globalAlpha = 1;
    c.shadowColor = "#b2e7ff";
    c.shadowBlur = 18;
    c.fillStyle = "#d9f2ff";
    disc(x, y, r);
    c.globalCompositeOperation = "destination-out";
    disc(x + r * 0.5, y - r * 0.35, r * 0.9);
    c.globalCompositeOperation = "source-over";
  };
  const cloud = (x: number, y: number, k: number, color = "#b2c8e6") => {
    c.shadowColor = "#66e0ff";
    c.shadowBlur = 12;
    c.fillStyle = color;
    c.beginPath();
    c.arc(x - 18 * k, y, 14 * k, 0, Math.PI * 2);
    c.arc(x, y - 10 * k, 19 * k, 0, Math.PI * 2);
    c.arc(x + 20 * k, y, 14 * k, 0, Math.PI * 2);
    c.rect(x - 18 * k, y, 38 * k, 14 * k);
    c.fill();
  };
  const drift = Math.sin(t * 0.8) * 5;

  switch (kind) {
    case "sun":
      sun(64, 64, 22);
      break;
    case "moon":
      moon(62, 62, 24);
      break;
    case "sun-cloud":
      sun(48, 46, 17);
      cloud(72 + drift, 80, 1);
      break;
    case "moon-cloud":
      moon(48, 46, 18);
      cloud(72 + drift, 82, 1);
      break;
    case "cloud":
      cloud(54 + drift, 58, 0.9, "#8ea3c0");
      cloud(70 - drift, 76, 1.1);
      break;
    case "fog":
      c.strokeStyle = "#b2c8e6";
      c.lineWidth = 6;
      [40, 58, 76, 94].forEach((y, i) => {
        const off = Math.sin(t * 1.2 + i) * 10;
        c.globalAlpha = 0.5 + 0.12 * i;
        c.beginPath();
        c.moveTo(24 + off, y);
        c.lineTo(104 + off, y);
        c.stroke();
      });
      break;
    default: {
      cloud(64 + drift, 50, 1.05, kind === "storm" ? "#6f7f9c" : "#b2c8e6");
      c.shadowBlur = 8;
      for (let i = 0; i < 6; i++) {
        const x = 34 + i * 12;
        const y = 74 + ((t * 70 + i * 23) % 44);
        if (kind === "snow") {
          c.fillStyle = "#e8f6ff";
          disc(x + Math.sin(t * 2 + i) * 3, y, 3);
        } else {
          c.strokeStyle = c.shadowColor = "#66e0ff";
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x - 4, y + 10);
          c.stroke();
        }
      }
      // Lightning: a short flash every ~3 s.
      if (kind === "storm" && t % 3 < 0.18) {
        c.fillStyle = c.shadowColor = "#ffd166";
        c.shadowBlur = 24;
        c.beginPath();
        c.moveTo(66, 60);
        c.lineTo(54, 86);
        c.lineTo(64, 86);
        c.lineTo(56, 110);
        c.lineTo(78, 78);
        c.lineTo(67, 78);
        c.lineTo(74, 60);
        c.fill();
      }
    }
  }
  c.restore();
}

// ---------------------------------------------------------------------------------------------
// 12-hour chart: neon temperature line over rain-chance bars, redrawn when data or width change.

function HourChart({ times, temps, rain }: { times: string[]; temps: number[]; rain: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || temps.length < 2) return;
    const draw = () => {
      const dpr = devicePixelRatio;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const top = 12;
      const bottom = H - 13;
      const min = Math.min(...temps) - 1;
      const max = Math.max(...temps) + 1;
      const x = (i: number) => 8 + (i / (temps.length - 1)) * (W - 16);
      const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top);

      rain.forEach((p, i) => {
        if (!p) return;
        ctx.fillStyle = `rgba(102,224,255,${0.15 + (p / 100) * 0.45})`;
        const h = (p / 100) * (bottom - top);
        ctx.fillRect(x(i) - 4, bottom - h, 8, h);
      });

      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "#ffd166");
      grad.addColorStop(1, "#ff6bd6");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.shadowColor = "#ff6bd6";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      temps.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.font = "9px ui-monospace, Consolas, monospace";
      ctx.textAlign = "center";
      for (let i = 0; i < temps.length; i += 3) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x(i), y(temps[i]), 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#e8f6ff";
        ctx.fillText(`${Math.round(temps[i])}°`, x(i), y(temps[i]) - 5);
        ctx.fillStyle = "#7d97bd";
        ctx.fillText(i === 0 ? tr("nay", "now") : `${times[i].slice(11, 13)}h`, x(i), H - 2);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [times, temps, rain]);
  return <canvas ref={ref} className="block h-[64px] w-full shrink-0" aria-hidden />;
}
