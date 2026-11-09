import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle, Briefcase, CheckCircle2, Gamepad2, Info, Loader2, MemoryStick, Power, RefreshCw, RotateCcw, Rocket, ShieldCheck, X,
} from "lucide-react";
import { tr, tx } from "../../lib/i18n";
import { iconUrl } from "../../lib/ipc";
import { bytes, util, type ApplyReport, type Overview, type RamReport, type Rec, type StartupEntry, type TweakId, type TweakValue } from "../../lib/utilities";
import { settingsWithDefaults, useDoc } from "../../stores/doc";
import { PROFILES, QUIET, QUIET_KEYS, type Profile, type ProfileId } from "./profiles";
import { TWEAK, TWEAK_GROUPS } from "./labels";

const ICON: Record<ProfileId, typeof Gamepad2> = { gaming: Gamepad2, working: Briefcase, normal: RotateCcw };
const GUIDS: Record<string, string> = {
  "381b4222-f694-41f0-9685-ff5bb260df2e": "Balanced",
  "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c": "High performance",
  "a1841308-3541-4fab-bc81-f71556f20b4a": "Power saver",
  "e9a42b02-d5df-448d-aa00-03f14749eb61": "Ultimate Performance",
};

function show(id: TweakId, v: TweakValue | null | undefined, ov: Overview | null): string {
  if (v == null) return "—";
  if (id === "power_plan") {
    const s = String(v);
    if (s === "ultimate") return "Ultimate Performance";
    if (s === "high") return "High performance";
    if (s === "balanced") return "Balanced";
    if (ov && s === ov.ultimate) return "Ultimate Performance";
    if (ov && ov.tweaks.find((t) => t.id === "power_plan")?.value === s && ov.planName) return ov.planName;
    return GUIDS[s] ?? s.slice(0, 8);
  }
  if (id === "standby_ac") return Number(v) === 0 ? tr("không bao giờ", "never") : `${Math.round(Number(v) / 60)} ${tr("phút", "min")}`;
  return v ? tr("Bật", "On") : tr("Tắt", "Off");
}

export function Optimize({ onCleanUp }: { onCleanUp: () => void }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [confirm, setConfirm] = useState<Profile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ title: string; r: ApplyReport } | null>(null);
  const [ram, setRam] = useState<RamReport | null>(null);
  const settings = useDoc((s) => s.settings);
  const setSettings = useDoc((s) => s.setSettings);

  const refresh = async () => {
    setOv(await util.optimizeState().catch(() => null));
    setRecs(await util.analyze().catch(() => []));
  };
  useEffect(() => void refresh(), []);

  const value = (id: TweakId) => ov?.tweaks.find((t) => t.id === id)?.value;

  const apply = async (p: Profile) => {
    setConfirm(null);
    setBusy(p.id);
    let r: ApplyReport;
    if (p.id === "normal") {
      r = await util.optimizeRestore();
      const saved = settingsWithDefaults(useDoc.getState().settings).optimizeFx;
      if (saved) setSettings({ ...saved, optimizeFx: null });
    } else {
      const changes = Object.entries(p.tweaks).map(([id, v]) => ({ id: id as TweakId, value: v as TweakValue }));
      r = await util.optimizeApply(p.id, changes, p.close, p.freeRam);
      const s = useDoc.getState().settings;
      if (p.quietPieDesk && !s.optimizeFx) {
        const full = settingsWithDefaults(s);
        setSettings({ ...QUIET, optimizeFx: Object.fromEntries(QUIET_KEYS.map((k) => [k, full[k]])) });
      } else if (!p.quietPieDesk && s.optimizeFx) {
        setSettings({ ...s.optimizeFx, optimizeFx: null });
      }
    }
    setReport({ title: tx(p.name), r });
    setBusy(null);
    await refresh();
  };

  const setTweak = async (id: TweakId, v: TweakValue) => {
    setBusy(id);
    const r = await util.optimizeApply(null, [{ id, value: v }], [], false);
    const failed = r.results.find((x) => !x.ok);
    if (failed || r.reboot) setReport({ title: tx(TWEAK[id].name), r });
    setBusy(null);
    await refresh();
  };

  const freeRam = async (deep: boolean) => {
    setBusy(deep ? "ram-deep" : "ram");
    setRam(await util.freeRam(deep).catch(() => null));
    setBusy(null);
  };

  const active = (ov?.profile ?? "normal") as ProfileId | "custom";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 lg:grid-cols-3">
        {PROFILES.map((p) => {
          const Icon = ICON[p.id];
          const on = active === p.id;
          return (
            <div key={p.id} className={clsx("pd-profile", `pd-profile-${p.id}`, on && "pd-profile-on")}>
              <div className="flex items-start justify-between gap-2">
                <span className="pd-profile-icon"><Icon size={20} /></span>
                {on && <span className="pd-tag pd-tag-good"><CheckCircle2 size={11} /> {tr("đang dùng", "active")}</span>}
              </div>
              <div className="mt-3 text-base font-semibold">{tx(p.name)}</div>
              <div className="pd-muted text-xs">{tx(p.tagline)}</div>
              <ul className="mt-3 flex flex-1 flex-col gap-1.5 text-[12.5px] leading-snug">
                {p.points.map((pt) => <li key={pt[1]} className="pd-profile-point">{tx(pt)}</li>)}
              </ul>
              <button className={clsx("pd-btn mt-4 justify-center", p.id !== "normal" && "pd-btn-primary")}
                disabled={!!busy || !ov || (p.id === "normal" && !ov.changed.length && !ov.closed.length && !settings.optimizeFx)}
                onClick={() => setConfirm(p)}>
                {busy === p.id ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
                {p.id === "normal" ? tr("Khôi phục", "Restore") : tr("Áp dụng", "Apply")}
              </button>
            </div>
          );
        })}
      </div>
      {active === "custom" && <p className="pd-muted -mt-3 text-xs">{tr("Đang dùng tinh chỉnh thủ công — Normal sẽ trả mọi thứ về như cũ.", "Manual tweaks in use — Normal puts everything back.")}</p>}

      {report && <ReportPanel title={report.title} r={report.r} onClose={() => setReport(null)} />}

      <section className="pd-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold"><MemoryStick size={16} /> {tr("Giải phóng RAM", "Free up RAM")}</div>
            <div className="pd-muted text-xs">{tr("Thu gọn bộ nhớ của mọi app; \"Sâu\" xoá thêm standby list (chống giật game, cần admin).",
              "Trims every app's memory; \"Deep\" also clears the standby list (fixes game stutter, needs admin).")}</div>
          </div>
          <div className="flex gap-2">
            <button className="pd-btn" disabled={!!busy} onClick={() => freeRam(false)}>{busy === "ram" ? <Loader2 size={14} className="animate-spin" /> : <MemoryStick size={14} />} {tr("Nhanh", "Quick")}</button>
            <button className="pd-btn" disabled={!!busy} onClick={() => freeRam(true)}>{busy === "ram-deep" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} {tr("Sâu", "Deep")}</button>
          </div>
        </div>
        {ram && (
          <div className="text-xs">
            <span className="text-emerald-300">{tr(`Trống ${bytes(ram.before)} → ${bytes(ram.after)}`, `Free ${bytes(ram.before)} → ${bytes(ram.after)}`)}</span>
            <span className="pd-muted"> / {bytes(ram.total)}</span>
            {ram.standby && "Err" in ram.standby && <span className="text-amber-300"> · standby: {ram.standby.Err === "cancelled" ? tr("đã từ chối admin", "admin declined") : ram.standby.Err}</span>}
          </div>
        )}
      </section>

      <Recommendations recs={recs} onRefresh={refresh} onCleanUp={onCleanUp}
        onProfile={(id) => setConfirm(PROFILES.find((p) => p.id === id) ?? null)}
        onTweak={(id, v) => setTweak(id, v)} onRam={() => freeRam(true)} />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="pd-h2 !mb-0">{tr("Tinh chỉnh thủ công", "Manual tweaks")}</h2>
          <button className="pd-icon-btn" title={tr("Đọc lại", "Reload")} onClick={refresh}><RefreshCw size={14} /></button>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {TWEAK_GROUPS.map((g) => (
            <div key={g.id}>
              <div className="pd-muted mb-1.5 text-[11px] uppercase tracking-wider">{tx(g.label)}</div>
              <div className="pd-list">
                {ov?.tweaks.filter((t) => TWEAK[t.id].group === g.id).map((t) => (
                  <div key={t.id} className="pd-row">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {tx(TWEAK[t.id].name)}
                        {t.admin && <span className="pd-tag"><ShieldCheck size={11} /> admin</span>}
                        {t.reboot && <span className="pd-tag"><Power size={11} /> {tr("khởi động lại", "restart")}</span>}
                        {ov.changed.includes(t.id) && <span className="pd-tag pd-tag-good">{tr("đã chỉnh", "tweaked")}</span>}
                      </div>
                      <div className="pd-muted text-xs leading-relaxed">{tx(TWEAK[t.id].desc)}</div>
                    </div>
                    <TweakControl id={t.id} value={t.value} ov={ov} busy={busy === t.id} onChange={(v) => setTweak(t.id, v)} />
                  </div>
                ))}
                {!ov && <div className="pd-empty"><Loader2 size={14} className="inline animate-spin" /></div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <StartupApps />

      {confirm && ov && <ConfirmDialog p={confirm} ov={ov} value={value} onCancel={() => setConfirm(null)} onApply={() => apply(confirm)} />}
    </div>
  );
}

function TweakControl({ id, value, ov, busy, onChange }: { id: TweakId; value: TweakValue | null; ov: Overview; busy: boolean; onChange: (v: TweakValue) => void }) {
  if (busy) return <Loader2 size={16} className="animate-spin text-[var(--pd-accent)]" />;
  if (value == null) return <span className="pd-muted text-xs">—</span>;
  if (id === "power_plan") {
    const current = String(value);
    const opts = [["balanced", "Balanced"], ["high", "High"], ["ultimate", "Ultimate"]] as const;
    const name = current === ov.ultimate ? "Ultimate Performance" : GUIDS[current];
    const at = name === "Ultimate Performance" ? "ultimate" : name === "High performance" ? "high" : name === "Balanced" ? "balanced" : null;
    return (
      <div className="flex shrink-0 gap-1">
        {opts.map(([v, l]) => (
          <button key={v} className={clsx("pd-chip !px-2 !py-0.5 !text-[11.5px]", at === v && "pd-chip-active")} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    );
  }
  if (id === "standby_ac") {
    const never = Number(value) === 0;
    return <Switch on={never} onChange={(v) => onChange(v ? 0 : 30 * 60)} />;
  }
  return <Switch on={!!value} onChange={onChange} />;
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={clsx("pd-switch shrink-0", on && "pd-switch-on")} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function ConfirmDialog({ p, ov, value, onCancel, onApply }: {
  p: Profile; ov: Overview; value: (id: TweakId) => TweakValue | null | undefined; onCancel: () => void; onApply: () => void;
}) {
  const changes = p.id === "normal"
    ? ov.changed.map((id) => ({ id: id as TweakId, from: value(id as TweakId), to: null as TweakValue | null }))
    : (Object.entries(p.tweaks) as [TweakId, TweakValue][])
        .filter(([id, v]) => {
          const cur = value(id);
          if (id === "power_plan") return show(id, cur, ov) !== show(id, v, ov);
          return cur !== v;
        })
        .map(([id, v]) => ({ id, from: value(id), to: v }));
  const admin = changes.some((c) => ov.tweaks.find((t) => t.id === c.id)?.admin) || p.freeRam;
  const reboot = changes.some((c) => ov.tweaks.find((t) => t.id === c.id)?.reboot);
  return (
    <div className="pd-about-backdrop" onMouseDown={onCancel}>
      <div className="pd-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">{p.id === "normal" ? tr("Khôi phục Normal", "Restore Normal") : tr(`Áp dụng ${tx(p.name)}`, `Apply ${tx(p.name)}`)}</div>
          <button className="pd-icon-btn" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="pd-list mt-4 max-h-[50vh] overflow-y-auto">
          {changes.map((c) => (
            <div key={c.id} className="pd-row !py-2">
              <span className="flex-1 text-sm">{tx(TWEAK[c.id].name)}</span>
              <span className="pd-muted text-xs">{show(c.id, c.from, ov)}</span>
              <span className="text-xs">→</span>
              <span className="text-xs font-medium text-[var(--pd-accent)]">{c.to == null ? tr("như cũ", "original") : show(c.id, c.to, ov)}</span>
            </div>
          ))}
          {changes.length === 0 && <div className="pd-empty">{tr("Các tinh chỉnh đã đúng như profile.", "Tweaks already match this profile.")}</div>}
        </div>
        {p.close.length > 0 && (
          <p className="pd-muted mt-3 text-xs leading-relaxed">{tr("Đóng nếu đang mở: ", "Closes if running: ")}{p.close.map((n) => n.replace(/\.exe$/i, "")).join(", ")}
            {tr(" — Normal sẽ mở lại.", " — Normal starts them again.")}</p>
        )}
        {p.id === "normal" && ov.closed.length > 0 && (
          <p className="pd-muted mt-3 text-xs">{tr("Mở lại: ", "Starts again: ")}{ov.closed.map((c) => c.split("\\").pop()).join(", ")}</p>
        )}
        <div className="mt-3 flex flex-col gap-1 text-xs">
          {admin && !ov.isAdmin && <span className="pd-muted flex items-center gap-1.5"><ShieldCheck size={13} />{tr("Windows sẽ hỏi quyền admin một lần.", "Windows will ask for admin rights once.")}</span>}
          {reboot && <span className="flex items-center gap-1.5 text-amber-300"><Power size={13} />{tr("HAGS có hiệu lực sau khi khởi động lại.", "HAGS takes effect after a restart.")}</span>}
          {p.id !== "normal" && <span className="pd-muted flex items-center gap-1.5"><Info size={13} />{tr("Giá trị gốc được lưu lại — bấm Normal để trả về.", "Your originals are saved — Normal puts them back.")}</span>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="pd-btn" onClick={onCancel}>{tr("Huỷ", "Cancel")}</button>
          <button className="pd-btn pd-btn-primary" onClick={onApply}><Rocket size={15} /> {p.id === "normal" ? tr("Khôi phục", "Restore") : tr("Áp dụng", "Apply")}</button>
        </div>
      </div>
    </div>
  );
}

function ReportPanel({ title, r, onClose }: { title: string; r: ApplyReport; onClose: () => void }) {
  const ok = r.results.filter((x) => x.ok);
  const failed = r.results.filter((x) => !x.ok);
  const cancelled = failed.some((f) => f.error === "cancelled");
  return (
    <section className="pd-section !gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {failed.length ? <AlertTriangle size={16} className="text-amber-300" /> : <CheckCircle2 size={16} className="text-emerald-300" />}
          {title}: {tr(`${ok.length} thay đổi`, `${ok.length} changes`)}{r.unchanged.length > 0 && tr(`, ${r.unchanged.length} đã đúng sẵn`, `, ${r.unchanged.length} already set`)}
        </div>
        <button className="pd-icon-btn" onClick={onClose}><X size={14} /></button>
      </div>
      {r.closed.length > 0 && <div className="pd-muted text-xs">{tr("Đã đóng: ", "Closed: ")}{r.closed.map((c) => c.split("\\").pop()).join(", ")}</div>}
      {r.relaunched.length > 0 && <div className="pd-muted text-xs">{tr("Đã mở lại: ", "Started again: ")}{r.relaunched.map((c) => c.split("\\").pop()).join(", ")}</div>}
      {r.ram && <div className="pd-muted text-xs">RAM: {bytes(r.ram.before)} → {bytes(r.ram.after)} {tr("trống", "free")}</div>}
      {r.reboot && <div className="flex items-center gap-1.5 text-xs text-amber-300"><Power size={13} />{tr("Khởi động lại để HAGS có hiệu lực.", "Restart for HAGS to take effect.")}</div>}
      {cancelled && <div className="text-xs text-amber-300">{tr("Bạn đã từ chối quyền admin — các mục admin giữ nguyên.", "Admin rights were declined — admin items were left as they were.")}</div>}
      {failed.filter((f) => f.error !== "cancelled").map((f) => (
        <div key={f.id} className="text-xs text-rose-300">{TWEAK[f.id as TweakId] ? tx(TWEAK[f.id as TweakId].name) : f.id}: {f.error}</div>
      ))}
    </section>
  );
}

function Recommendations({ recs, onRefresh, onCleanUp, onProfile, onTweak, onRam }: {
  recs: Rec[] | null;
  onRefresh: () => void;
  onCleanUp: () => void;
  onProfile: (id: ProfileId) => void;
  onTweak: (id: TweakId, v: TweakValue) => void;
  onRam: () => void;
}) {
  const text = (r: Rec): { title: string; detail: string; action?: [string, () => void] } => {
    const d = (r.data ?? {}) as Record<string, number & string>;
    switch (r.id) {
      case "disk_low":
        return { title: tr(`Ổ ${d.mount} sắp đầy`, `Drive ${d.mount} is nearly full`), detail: tr(`Chỉ còn ${bytes(d.free)} / ${bytes(d.total)} — Windows chậm hẳn khi ổ hệ thống dưới 15% trống.`, `Only ${bytes(d.free)} of ${bytes(d.total)} left — Windows slows down below 15 % free.`), action: [tr("Dọn dẹp", "Clean up"), onCleanUp] };
      case "ram_high":
        return { title: tr("RAM đang dùng nhiều", "Memory is running high"), detail: tr(`${bytes(d.used)} / ${bytes(d.total)} đang dùng.`, `${bytes(d.used)} of ${bytes(d.total)} in use.`), action: [tr("Giải phóng", "Free up"), onRam] };
      case "uptime":
        return { title: tr(`Máy chạy liên tục ${d.days} ngày`, `Up for ${d.days} days`), detail: tr("Khởi động lại giúp xả bộ nhớ rò rỉ và hoàn tất cập nhật.", "A restart clears leaked memory and finishes updates.") };
      case "startup_many":
        return { title: tr(`${d.count} app tự chạy khi khởi động`, `${d.count} apps start with Windows`), detail: tr("Tắt bớt ở mục \"Ứng dụng khởi động\" bên dưới để máy lên nhanh hơn.", "Turn some off under \"Startup apps\" below for faster boots.") };
      case "power_balanced":
        return { title: tr(`Gói nguồn đang là ${d.name || "Balanced"}`, `Power plan is ${d.name || "Balanced"}`), detail: tr("CPU bị hạ xung khi rảnh; Gaming / Working giữ xung cao.", "The CPU clocks down when idle; Gaming / Working keep clocks up."), action: [tr("Dùng Gaming", "Use Gaming"), () => onProfile("gaming")] };
      case "game_dvr_on":
        return { title: tr("Game Bar đang quay nền", "Game Bar records in the background"), detail: tr("Tốn GPU và ghi ổ đĩa liên tục khi chơi.", "Costs GPU time and constant disk writes while playing."), action: [tr("Tắt", "Turn off"), () => onTweak("game_dvr", false)] };
      case "game_mode_off":
        return { title: tr("Game Mode đang tắt", "Game Mode is off"), detail: tr("Bật để Windows ưu tiên game và hoãn cập nhật khi chơi.", "Turn on so Windows favours games and holds updates."), action: [tr("Bật", "Turn on"), () => onTweak("game_mode", true)] };
      case "telemetry_on":
        return { title: tr("Telemetry đang chạy", "Telemetry is running"), detail: tr("DiagTrack gửi dữ liệu chẩn đoán nền; có thể tạm dừng.", "DiagTrack uploads diagnostics in the background; it can be paused."), action: [tr("Tạm dừng", "Pause"), () => onTweak("svc_diagtrack", false)] };
      case "hiberfil":
        return { title: tr(`hiberfil.sys chiếm ${bytes(d.size)}`, `hiberfil.sys takes ${bytes(d.size)}`), detail: tr("Nếu không dùng Hibernate, tắt ở Dọn dẹp → Nâng cao.", "If you don't hibernate, turn it off in Clean up → Advanced."), action: [tr("Mở Dọn dẹp", "Open Clean up"), onCleanUp] };
      case "on_battery":
        return { title: tr("Đang chạy pin", "Running on battery"), detail: tr("Gaming / Working tốn pin hơn nhiều — nên cắm sạc.", "Gaming / Working drain the battery much faster — plug in.") };
      case "profile_active":
        return { title: tr(`Profile ${d.profile} đang bật`, `Profile ${d.profile} is on`), detail: tr("Bấm Normal khi xong để trả máy về như cũ.", "Use Normal when you're done to put things back.") };
      default:
        return { title: tr("Máy đang ở trạng thái tốt", "Your PC looks good"), detail: tr("Không có vấn đề lớn nào.", "Nothing major to fix.") };
    }
  };
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="pd-h2 !mb-0">{tr("Khuyến nghị", "Recommendations")}</h2>
        <button className="pd-icon-btn" title={tr("Phân tích lại", "Analyze again")} onClick={onRefresh}><RefreshCw size={14} /></button>
      </div>
      <div className="pd-list">
        {recs === null && <div className="pd-empty"><Loader2 size={14} className="inline animate-spin" /> {tr("Đang phân tích…", "Analyzing…")}</div>}
        {recs?.map((r) => {
          const t = text(r);
          return (
            <div key={r.id} className="pd-row">
              <span className={clsx("pd-rec-dot", `pd-rec-${r.level}`)} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t.title}</div>
                <div className="pd-muted text-xs leading-relaxed">{t.detail}</div>
              </div>
              {t.action && <button className="pd-btn shrink-0 !py-1 text-xs" onClick={t.action[1]}>{t.action[0]}</button>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const SCOPE: Record<string, [string, string]> = {
  user: ["Registry · bạn", "Registry · you"],
  machine: ["Registry · mọi user", "Registry · all users"],
  machine32: ["Registry 32-bit · mọi user", "Registry 32-bit · all users"],
  folder: ["Thư mục Startup", "Startup folder"],
  commonFolder: ["Startup chung", "Common Startup"],
};

function StartupApps() {
  const [list, setList] = useState<StartupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => util.startupApps().then(setList).catch(() => setList([]));
  useEffect(() => void load(), []);
  const on = list?.filter((e) => e.enabled).length ?? 0;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="pd-h2 !mb-0">{tr(`Ứng dụng khởi động (${on} bật)`, `Startup apps (${on} on)`)}</h2>
        <button className="pd-icon-btn" onClick={load}><RefreshCw size={14} /></button>
      </div>
      {error && <div className="mb-2 text-xs text-rose-300">{error === "cancelled" ? tr("Bạn đã từ chối quyền admin.", "Admin rights were declined.") : error}</div>}
      <div className="pd-list">
        {list?.map((e) => (
          <div key={e.scope + e.name} className={clsx("pd-row", !e.enabled && "opacity-55")}>
            <img src={iconUrl(e.path, 20)} className="size-5 shrink-0" alt="" onError={(ev) => (ev.currentTarget.style.visibility = "hidden")} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate text-sm font-medium">{e.name}{e.admin && <span className="pd-tag"><ShieldCheck size={11} /> admin</span>}</div>
              <div className="pd-muted truncate text-xs" title={e.command}>{tr(...SCOPE[e.scope] ?? [e.scope, e.scope])} · {e.path}</div>
            </div>
            <Switch on={e.enabled} onChange={async (v) => {
              setError(null);
              try {
                await util.startupSet(e, v);
                setList((l) => l?.map((x) => (x === e ? { ...x, enabled: v } : x)) ?? null);
              } catch (err) {
                setError(String(err));
              }
            }} />
          </div>
        ))}
        {list === null && <div className="pd-empty"><Loader2 size={14} className="inline animate-spin" /></div>}
        {list?.length === 0 && <div className="pd-empty">{tr("Không có app nào tự chạy.", "No startup apps.")}</div>}
      </div>
      <p className="pd-muted mt-2 text-xs">{tr("Tắt giống hệt Task Manager (StartupApproved) — bật lại được ở đây hoặc trong Task Manager.",
        "Turned off exactly like Task Manager does (StartupApproved) — turn back on here or in Task Manager.")}</p>
    </section>
  );
}
