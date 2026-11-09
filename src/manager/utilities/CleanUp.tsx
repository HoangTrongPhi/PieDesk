import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, FileSearch, FolderOpen, HardDrive, Loader2, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { locale, tr, tx } from "../../lib/i18n";
import { ipc } from "../../lib/ipc";
import { bytes, util, type BigFile, type CleanCategory, type CleanResult, type Drive } from "../../lib/utilities";
import { Segmented } from "../../widgets/fields";
import { CLEAN, GROUPS } from "./labels";

export function CleanUp() {
  const [view, setView] = useState<"junk" | "large">("junk");
  const [drives, setDrives] = useState<Drive[]>([]);
  const loadDrives = () => util.drives().then(setDrives).catch(() => {});
  useEffect(() => void loadDrives(), []);
  return (
    <div className="flex flex-col gap-5">
      <Drives drives={drives} />
      <Segmented value={view} onChange={setView}
        options={[
          { value: "junk", label: tr("Dọn rác hệ thống", "System junk") },
          { value: "large", label: tr("Tìm file lớn", "Large files") },
        ]} />
      {view === "junk" ? <Junk onCleaned={loadDrives} /> : <LargeFiles onDeleted={loadDrives} />}
    </div>
  );
}

function Drives({ drives }: { drives: Drive[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {drives.map((d) => {
        const used = 1 - d.free / d.total;
        return (
          <div key={d.mount} className="pd-section !gap-2 !py-3">
            <div className="flex items-center gap-2 text-sm">
              <HardDrive size={15} className="pd-muted" />
              <span className="font-semibold">{d.mount}</span>
              <span className="pd-muted truncate text-xs">{d.name}{d.system && " · Windows"}</span>
            </div>
            <div className="pd-meter"><i className={clsx(used > 0.9 && "pd-meter-hot")} style={{ width: `${used * 100}%` }} /></div>
            <div className="pd-muted text-xs">{tr(`Trống ${bytes(d.free)} / ${bytes(d.total)}`, `${bytes(d.free)} free of ${bytes(d.total)}`)}</div>
          </div>
        );
      })}
    </div>
  );
}

type Phase = "scanning" | "ready" | "cleaning" | "done";

function Junk({ onCleaned }: { onCleaned: () => void }) {
  const [cats, setCats] = useState<CleanCategory[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("scanning");
  const [results, setResults] = useState<CleanResult[]>([]);

  const scan = async () => {
    setPhase("scanning");
    const list = await util.scan().catch(() => [] as CleanCategory[]);
    setCats(list);
    setPicked((prev) => {
      const keep = list.filter((c) => c.present && (prev.size ? prev.has(c.id) : c.defaultOn));
      return new Set(keep.map((c) => c.id));
    });
    setPhase("ready");
  };
  useEffect(() => void scan(), []);

  const chosen = cats.filter((c) => picked.has(c.id));
  const total = chosen.reduce((s, c) => s + c.size, 0);
  const found = cats.filter((c) => c.present).reduce((s, c) => s + c.size, 0);
  const needAdmin = chosen.some((c) => c.admin);
  const busy = cats.filter((c) => picked.has(c.id) && c.running.length).flatMap((c) => c.running);

  const clean = async () => {
    setPhase("cleaning");
    const res = await util.clean([...picked]).catch((e) => [{ id: "*", freed: 0, files: 0, skipped: 0, error: String(e) }]);
    setResults(res);
    setPhase("done");
    onCleaned();
  };

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <div className="pd-hero">
        <Ring value={phase === "scanning" ? 0 : total} max={Math.max(found, 1)} spinning={phase === "scanning" || phase === "cleaning"} />
        <div className="min-w-0 flex-1">
          {phase === "scanning" ? (
            <>
              <div className="text-lg font-semibold">{tr("Đang quét…", "Scanning…")}</div>
              <div className="pd-muted text-sm">{tr("Đo cache, file tạm, log của Windows và các ứng dụng.", "Measuring caches, temp files and logs of Windows and your apps.")}</div>
            </>
          ) : phase === "cleaning" ? (
            <>
              <div className="text-lg font-semibold">{tr("Đang dọn…", "Cleaning…")}</div>
              <div className="pd-muted text-sm">{needAdmin ? tr("Hãy đồng ý hộp thoại quyền admin của Windows.", "Accept Windows' admin prompt.") : tr("Chờ một chút.", "One moment.")}</div>
            </>
          ) : phase === "done" ? (
            <DoneSummary results={results} />
          ) : (
            <>
              <div className="pd-muted text-xs uppercase tracking-wider">{tr("Có thể giải phóng", "Ready to free")}</div>
              <div className="pd-big">{bytes(total)}</div>
              <div className="pd-muted text-sm">
                {tr(`${chosen.length} mục đã chọn · tìm thấy tổng ${bytes(found)}`, `${chosen.length} picked · ${bytes(found)} found in total`)}
              </div>
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === "done" ? (
              <button className="pd-btn pd-btn-primary" onClick={scan}><RefreshCw size={14} /> {tr("Quét lại", "Scan again")}</button>
            ) : (
              <>
                <button className="pd-btn pd-btn-primary" disabled={phase !== "ready" || !chosen.length} onClick={clean}>
                  <Sparkles size={15} /> {tr("Dọn dẹp ngay", "Clean now")}
                </button>
                <button className="pd-btn" disabled={phase !== "ready"} onClick={scan}><RefreshCw size={14} /> {tr("Quét lại", "Rescan")}</button>
              </>
            )}
          </div>
          {phase === "ready" && (needAdmin || busy.length > 0) && (
            <div className="mt-3 flex flex-col gap-1 text-xs">
              {needAdmin && (
                <span className="pd-muted flex items-center gap-1.5"><ShieldCheck size={13} />
                  {tr("Có mục cần quyền admin — Windows sẽ hỏi một lần.", "Some items need admin rights — Windows will ask once.")}</span>
              )}
              {busy.length > 0 && (
                <span className="flex items-center gap-1.5 text-amber-300"><AlertTriangle size={13} />
                  {tr(`Đang mở: ${[...new Set(busy)].join(", ")} — đóng lại để dọn được hết.`, `Running: ${[...new Set(busy)].join(", ")} — close them to clean everything.`)}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {phase !== "scanning" && phase !== "done" &&
        GROUPS.map((g) => {
          const items = cats.filter((c) => c.group === g.id && (c.present || c.group === "advanced"));
          if (!items.length) return null;
          const all = items.every((c) => picked.has(c.id));
          const sub = items.filter((c) => picked.has(c.id)).reduce((s, c) => s + c.size, 0);
          return (
            <section key={g.id}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="pd-h2 !mb-0">{tx(g.label)}</h2>
                <div className="flex items-center gap-3 text-xs">
                  {sub > 0 && <span className="pd-muted">{bytes(sub)}</span>}
                  <button className="text-[var(--pd-accent)] hover:underline"
                    onClick={() => setPicked((s) => {
                      const n = new Set(s);
                      for (const c of items) all ? n.delete(c.id) : n.add(c.id);
                      return n;
                    })}>
                    {all ? tr("Bỏ chọn", "Clear") : tr("Chọn hết", "Select all")}
                  </button>
                </div>
              </div>
              <div className="pd-list">
                {items.map((c) => (
                  <label key={c.id} className="pd-row cursor-pointer">
                    <input type="checkbox" className="pd-check" checked={picked.has(c.id)} disabled={phase !== "ready"} onChange={() => toggle(c.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {CLEAN[c.id] ? tx(CLEAN[c.id].name) : c.id}
                        {c.admin && <span className="pd-tag" title={tr("Cần quyền admin", "Needs admin rights")}><ShieldCheck size={11} /> admin</span>}
                        {c.caution && <span className="pd-tag pd-tag-warn"><AlertTriangle size={11} /> {tr("cân nhắc", "think first")}</span>}
                        {c.running.length > 0 && <span className="pd-tag pd-tag-warn">{tr("đang mở", "running")}</span>}
                      </div>
                      <div className="pd-muted text-xs leading-relaxed">{CLEAN[c.id] ? tx(CLEAN[c.id].desc) : ""}</div>
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      {c.unknown ? <span className="pd-muted">—</span> : c.id === "dns" ? <span className="pd-muted">·</span> : bytes(c.size)}
                      {c.partial && c.admin && <div className="pd-muted text-[10.5px]">{tr("+ phần cần admin", "+ admin-only part")}</div>}
                      {c.files > 0 && !c.partial && <div className="pd-muted text-[10.5px]">{c.files.toLocaleString(locale())} {tr("file", "files")}</div>}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
    </>
  );
}

function DoneSummary({ results }: { results: CleanResult[] }) {
  const freed = results.reduce((s, r) => s + r.freed, 0);
  const files = results.reduce((s, r) => s + r.files, 0);
  const skipped = results.reduce((s, r) => s + r.skipped, 0);
  const cancelled = results.some((r) => r.error === "cancelled");
  const errors = results.filter((r) => r.error && r.error !== "cancelled");
  return (
    <>
      <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 size={18} /> <span className="text-sm font-medium">{tr("Đã dọn xong", "All clean")}</span></div>
      <div className="pd-big">{bytes(freed)}</div>
      <div className="pd-muted text-sm">
        {tr(`${files.toLocaleString(locale())} file đã xoá`, `${files.toLocaleString(locale())} files removed`)}
        {skipped > 0 && tr(` · bỏ qua ${skipped.toLocaleString(locale())} file đang được dùng`, ` · ${skipped.toLocaleString(locale())} in-use files skipped`)}
      </div>
      {cancelled && <div className="mt-1 text-xs text-amber-300">{tr("Bạn đã từ chối quyền admin — các mục admin được giữ nguyên.", "Admin rights were declined — admin items were left alone.")}</div>}
      {errors.map((r) => (
        <div key={r.id} className="mt-1 text-xs text-rose-300">{CLEAN[r.id] ? tx(CLEAN[r.id].name) : r.id}: {r.error}</div>
      ))}
    </>
  );
}

/** Circular gauge: how much of what was found is picked. */
function Ring({ value, max, spinning }: { value: number; max: number; spinning: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, value / max);
  return (
    <div className="relative grid size-32 shrink-0 place-items-center">
      <svg viewBox="0 0 128 128" className={clsx("absolute inset-0", spinning && "animate-spin [animation-duration:2.4s]")}>
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="10" />
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--pd-accent)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={spinning ? c * 0.72 : c * (1 - frac)} transform="rotate(-90 64 64)"
          style={{ transition: "stroke-dashoffset .6s ease", filter: "drop-shadow(0 0 6px var(--pd-accent))" }} />
      </svg>
      {spinning ? <Loader2 size={26} className="animate-spin text-[var(--pd-accent)]" /> : <Trash2 size={28} className="text-[var(--pd-accent)]" />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

const SIZES = [100, 500, 1024, 4096];

function LargeFiles({ onDeleted }: { onDeleted: () => void }) {
  const [root, setRoot] = useState("");
  const [min, setMin] = useState(500);
  const [files, setFiles] = useState<BigFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // Default root: the user profile folder.
    import("@tauri-apps/api/path").then((p) => p.homeDir()).then(setRoot).catch(() => setRoot("C:\\"));
  }, []);

  const scan = async () => {
    setBusy(true);
    setMsg(null);
    setPicked(new Set());
    setFiles(await util.largeFiles(root, min).catch(() => []));
    setBusy(false);
  };
  const total = useMemo(() => (files ?? []).filter((f) => picked.has(f.path)).reduce((s, f) => s + f.size, 0), [files, picked]);

  const recycle = async () => {
    const paths = [...picked];
    try {
      await util.recycle(paths);
      setFiles((f) => f?.filter((x) => !picked.has(x.path)) ?? null);
      setMsg(tr(`Đã chuyển ${paths.length} file (${bytes(total)}) vào Thùng rác.`, `Moved ${paths.length} files (${bytes(total)}) to the Recycle Bin.`));
      setPicked(new Set());
      onDeleted();
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <>
      <div className="pd-section">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-60 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-white/60">{tr("Thư mục / ổ đĩa", "Folder / drive")}</span>
            <input className="pd-input" value={root} onChange={(e) => setRoot(e.target.value)} />
          </label>
          <button className="pd-btn" onClick={async () => {
            const dir = await openDialog({ directory: true });
            if (typeof dir === "string") setRoot(dir);
          }}><FolderOpen size={15} /></button>
          <button className="pd-btn pd-btn-primary" disabled={busy || !root} onClick={scan}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileSearch size={15} />} {tr("Tìm", "Find")}
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="pd-muted">{tr("Lớn hơn", "Bigger than")}</span>
          <Segmented value={String(min)} onChange={(v) => setMin(Number(v))}
            options={SIZES.map((s) => ({ value: String(s), label: s >= 1024 ? `${s / 1024} GB` : `${s} MB` }))} />
        </div>
        <p className="pd-muted text-xs">{tr("Bỏ qua thư mục Windows, pagefile và hiberfil. File được chuyển vào Thùng rác — khôi phục được.",
          "Skips the Windows folder, pagefile and hiberfil. Files go to the Recycle Bin — they can be restored.")}</p>
      </div>
      {msg && <div className="text-sm text-emerald-300">{msg}</div>}
      {files && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="pd-h2 !mb-0">{tr(`${files.length} file`, `${files.length} files`)}</h2>
            <button className="pd-btn text-rose-300" disabled={!picked.size} onClick={recycle}>
              <Trash2 size={14} /> {tr(`Vào Thùng rác${picked.size ? ` (${bytes(total)})` : ""}`, `To Recycle Bin${picked.size ? ` (${bytes(total)})` : ""}`)}
            </button>
          </div>
          <div className="pd-list">
            {files.map((f) => {
              const name = f.path.split("\\").pop();
              const dir = f.path.slice(0, f.path.length - (name?.length ?? 0) - 1);
              return (
                <label key={f.path} className="pd-row cursor-pointer">
                  <input type="checkbox" className="pd-check" checked={picked.has(f.path)}
                    onChange={() => setPicked((s) => {
                      const n = new Set(s);
                      if (n.has(f.path)) n.delete(f.path);
                      else n.add(f.path);
                      return n;
                    })} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{name}</div>
                    <div className="pd-muted truncate text-xs" title={dir}>{dir}</div>
                  </div>
                  <span className="pd-muted hidden text-xs sm:block">{f.modified ? new Date(f.modified).toLocaleDateString(locale()) : ""}</span>
                  <span className="w-20 shrink-0 text-right text-sm tabular-nums">{bytes(f.size)}</span>
                  <button className="pd-icon-btn" title={tr("Mở thư mục", "Show in folder")} onClick={(e) => { e.preventDefault(); void ipc.revealPath(f.path); }}>
                    <FolderOpen size={14} />
                  </button>
                </label>
              );
            })}
            {files.length === 0 && <div className="pd-empty">{tr("Không có file nào lớn như vậy.", "No files that big.")}</div>}
          </div>
        </>
      )}
    </>
  );
}
