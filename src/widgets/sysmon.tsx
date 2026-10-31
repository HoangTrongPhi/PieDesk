import { Activity, HardDrive } from "lucide-react";
import { Toggle } from "./fields";
import { fmtBytes, useHistory, useHub } from "./hooks";
import { defineWidget } from "./types";
import { tr } from "../lib/i18n";

type Cpu = { total: number; cores: number[] };
type Mem = { used: number; total: number };
type Net = { rx: number; tx: number };
type Disk = { mount: string; name: string; total: number; free: number };

export function Spark({ data, max, color }: { data: number[]; max: number; color: string }) {
  if (data.length < 2) return <div className="h-7" />;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - (Math.min(v, max) / max) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full">
      <polyline points={`0,28 ${pts} 100,28`} fill={color} fillOpacity="0.15" stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Row({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-white/55">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  );
}

type Config = { cores: boolean };

export const sysmon = defineWidget<Config>({
  type: "sysmon",
  name: ["Hiệu năng hệ thống", "System monitor"],
  description: ["CPU, RAM, mạng theo thời gian thực. Chỉ đo khi widget hiển thị.", "Live CPU, RAM and network. Only measured while shown."],
  icon: Activity,
  defaultSize: { w: 260, h: 220 },
  minSize: { w: 180, h: 160 },
  defaultConfig: { cores: false },

  Component: ({ config }) => {
    const cpu = useHub<Cpu>("cpu");
    const mem = useHub<Mem>("mem");
    const net = useHub<Net>("net");
    const cpuHist = useHistory(cpu?.total);
    const memPct = mem ? (mem.used / mem.total) * 100 : undefined;
    const memHist = useHistory(memPct);
    const rxHist = useHistory(net?.rx);
    const netMax = Math.max(64 * 1024, ...rxHist);

    return (
      <div className="flex h-full flex-col gap-2 overflow-hidden p-1">
        <Row label="CPU" value={cpu ? `${cpu.total.toFixed(0)}%` : "…"}>
          <Spark data={cpuHist} max={100} color="#6c8cff" />
          {config.cores && cpu && (
            <div className="mt-1 flex h-6 items-end gap-px">
              {cpu.cores.map((c, i) => (
                <div key={i} className="flex-1 rounded-sm bg-[#6c8cff]/70" style={{ height: `${Math.max(4, c)}%` }} />
              ))}
            </div>
          )}
        </Row>
        <Row label="RAM" value={mem ? `${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}` : "…"}>
          <Spark data={memHist} max={100} color="#3ec7a8" />
        </Row>
        <Row label={tr("Mạng", "Net")} value={net ? `↓ ${fmtBytes(net.rx)}/s  ↑ ${fmtBytes(net.tx)}/s` : "…"}>
          <Spark data={rxHist} max={netMax} color="#ffb547" />
        </Row>
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <Toggle label={tr("Hiện từng nhân CPU", "Show every CPU core")} checked={config.cores} onChange={(cores) => setConfig({ cores })} />
  ),
});

export const disks = defineWidget<Record<string, never>>({
  type: "disks",
  name: ["Ổ đĩa", "Disks"],
  description: ["Dung lượng trống của các ổ đĩa (cập nhật mỗi 10 giây).", "Free space on every drive (refreshed every 10 s)."],
  icon: HardDrive,
  defaultSize: { w: 240, h: 160 },
  minSize: { w: 180, h: 90 },
  defaultConfig: {},

  Component: () => {
    const list = useHub<Disk[]>("disk");
    if (!list) return <div className="grid h-full place-items-center text-xs text-white/50">{tr("Đang đọc…", "Reading…")}</div>;
    return (
      <div className="flex h-full flex-col gap-2.5 overflow-y-auto p-1">
        {list.map((d) => {
          const used = d.total ? 1 - d.free / d.total : 0;
          return (
            <div key={d.mount}>
              <div className="flex justify-between text-xs">
                <span className="font-medium">{d.mount.replace(/\\$/, "")} <span className="text-white/45">{d.name}</span></span>
                <span className="tabular-nums text-white/60">{fmtBytes(d.free)} {tr("trống", "free")}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${used * 100}%`, background: used > 0.9 ? "#ff6b81" : "var(--pd-accent)" }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  },
});
