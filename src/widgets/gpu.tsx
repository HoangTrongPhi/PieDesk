import clsx from "clsx";
import { Cpu as Chip } from "lucide-react";
import { tr } from "../lib/i18n";
import { iconUrl } from "../lib/ipc";
import { Field, Toggle } from "./fields";
import { fmtBytes, useHistory, useHub } from "./hooks";
import { Spark } from "./sysmon";
import { defineWidget } from "./types";

// Read by src-tauri/src/gpu.rs: NVML for NVIDIA (temperature, power, fan, clock), Windows' GPU
// counters for everything else and for the processes holding the most VRAM.

type GpuInfo = { name: string; load: number; memUsed: number; memTotal: number; temp?: number; power?: number; powerLimit?: number; fan?: number; clock?: number };
type VramUser = { pid: number; name: string; path: string; mem: number };
type Sample = { gpus: GpuInfo[]; top: VramUser[] };
type Config = { top: number; details: boolean };

const short = (name: string) => name.replace(/^(NVIDIA|AMD|Intel\(R\)|Intel)\s+/i, "").replace(/^GeForce\s+/i, "");

function Card({ g, details }: { g: GpuInfo; details: boolean }) {
  const loadHist = useHistory(g.load);
  const mem = g.memTotal ? g.memUsed / g.memTotal : 0;
  const chips = [
    g.temp !== undefined && { text: `${g.temp}°C`, warn: g.temp >= 83 },
    g.power !== undefined && { text: g.powerLimit ? `${g.power.toFixed(0)} / ${g.powerLimit.toFixed(0)} W` : `${g.power.toFixed(0)} W`, warn: false },
    g.fan !== undefined && { text: `${tr("Quạt", "Fan")} ${g.fan}%`, warn: false },
    g.clock !== undefined && { text: `${g.clock} MHz`, warn: false },
  ].filter(Boolean) as { text: string; warn: boolean }[];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-white/55" title={g.name}>{short(g.name)}</span>
        <span className="shrink-0 font-medium tabular-nums">{g.load.toFixed(0)}%</span>
      </div>
      <Spark data={loadHist} max={100} color="#a78bfa" />
      <div>
        <div className="flex justify-between text-xs">
          <span className="text-white/55">VRAM</span>
          <span className="tabular-nums">{fmtBytes(g.memUsed)}{g.memTotal ? ` / ${fmtBytes(g.memTotal)}` : ""}</span>
        </div>
        {g.memTotal > 0 && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${mem * 100}%`, background: mem > 0.9 ? "#ff6b81" : "#a78bfa" }} />
          </div>
        )}
      </div>
      {details && chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <span key={c.text} className={clsx("rounded-md px-1.5 py-0.5 text-[10px] tabular-nums", c.warn ? "bg-rose-500/25 text-rose-200" : "bg-white/8 text-white/70")}>{c.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default defineWidget<Config>({
  type: "gpu",
  name: ["GPU / VRAM", "GPU / VRAM"],
  description: ["Tải GPU, VRAM, nhiệt độ, điện năng và app đang chiếm VRAM nhiều nhất.", "GPU load, VRAM, temperature, power and the apps using the most VRAM."],
  icon: Chip,
  defaultSize: { w: 260, h: 250 },
  minSize: { w: 180, h: 120 },
  defaultConfig: { top: 3, details: true },

  Component: ({ config }) => {
    const s = useHub<Sample>("gpu");
    if (!s) return <div className="grid h-full place-items-center text-xs text-white/50">{tr("Đang đọc…", "Reading…")}</div>;
    if (!s.gpus.length) return <div className="grid h-full place-items-center text-xs text-white/50">{tr("Không tìm thấy GPU", "No GPU found")}</div>;
    const top = s.top.slice(0, config.top);
    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-1">
        {s.gpus.map((g, i) => <Card key={`${g.name}-${i}`} g={g} details={config.details} />)}
        {top.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{tr("Chiếm VRAM nhiều nhất", "Top VRAM users")}</div>
            {top.map((p) => (
              <div key={p.pid} className="flex items-center gap-2 text-xs" title={p.path}>
                {p.path ? <img src={iconUrl(p.path, 16)} alt="" draggable={false} className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums text-white/60">{fmtBytes(p.mem)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Toggle label={tr("Nhiệt độ, điện năng, quạt, xung (GPU NVIDIA)", "Temperature, power, fan, clock (NVIDIA GPUs)")} checked={config.details} onChange={(details) => setConfig({ details })} />
      <Field label={config.top ? tr(`Hiện ${config.top} app chiếm VRAM nhiều nhất`, `Show the top ${config.top} VRAM users`) : tr("Không hiện app chiếm VRAM", "Hide VRAM users")}>
        <input type="range" min={0} max={8} value={config.top} onChange={(e) => setConfig({ top: Number(e.target.value) })} />
      </Field>
    </>
  ),
});
