import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle, CheckCircle2, Database, File, FileSearch, Folder, FolderOpen, Hammer, Loader2, Package, RefreshCw, RotateCcw, Search, ShieldCheck, ShoppingBag, Trash2, X,
} from "lucide-react";
import { locale, tr } from "../../lib/i18n";
import { iconUrl, ipc } from "../../lib/ipc";
import { bytes, MSI_OK, useAdminQuiet, util, type Leftover, type Program, type RemoveResult, type StoreApp } from "../../lib/utilities";
import { Segmented } from "../../widgets/fields";

type Sort = "name" | "size" | "date";

/** Programs listed once per manager session: switching tabs does not re-read the registry. */
let cachedPrograms: Program[] | null = null;

/**
 * Utilities → Uninstaller, in the spirit of IObit Uninstaller: every installed program with its
 * size and install date, batch uninstall through each program's own uninstaller, then a scan for
 * folders and registry keys it left behind (Recycle Bin / .reg backup, so it can be undone).
 */
export function Uninstall() {
  const [source, setSource] = useState<"programs" | "store">("programs");
  return (
    <div className="flex flex-col gap-5">
      <Segmented value={source} onChange={setSource}
        options={[
          { value: "programs", label: tr("Chương trình", "Programs") },
          { value: "store", label: tr("Ứng dụng Microsoft Store", "Microsoft Store apps") },
        ]} />
      {source === "programs" ? <Programs /> : <StoreApps />}
    </div>
  );
}

function Programs() {
  const [list, setList] = useState<Program[] | null>(cachedPrograms);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<Program[] | null>(null);

  const load = async () => {
    setLoading(true);
    const l = await util.programs().catch(() => [] as Program[]);
    cachedPrograms = l;
    setList(l);
    setPicked((s) => new Set([...s].filter((k) => l.some((p) => p.key === k))));
    setLoading(false);
  };
  useEffect(() => {
    if (!cachedPrograms) void load();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const l = (list ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.publisher.toLowerCase().includes(q));
    if (sort === "size") l.sort((a, b) => b.size - a.size);
    else if (sort === "date") l.sort((a, b) => b.installed.localeCompare(a.installed));
    return l;
  }, [list, query, sort]);
  const total = (list ?? []).reduce((s, p) => s + p.size, 0);
  const chosen = (list ?? []).filter((p) => picked.has(p.key));

  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  if (queue) {
    return (
      <Flow
        queue={queue}
        onClose={() => {
          setQueue(null);
          setPicked(new Set());
          void load();
        }}
      />
    );
  }

  return (
    <>
      <div className="pd-section">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex min-w-56 flex-1 items-center">
            <Search size={14} className="pd-muted pointer-events-none absolute left-3" />
            <input className="pd-input w-full !pl-8" placeholder={tr("Tìm theo tên hoặc nhà phát hành…", "Search by name or publisher…")}
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="pd-btn" disabled={loading} onClick={load} title={tr("Tải lại danh sách", "Reload list")}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button className="pd-btn pd-btn-primary" disabled={!chosen.length} onClick={() => setQueue(chosen)}>
            <Trash2 size={14} /> {chosen.length ? tr(`Gỡ ${chosen.length} chương trình`, `Uninstall ${chosen.length}`) : tr("Gỡ cài đặt", "Uninstall")}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="pd-muted">{tr("Sắp xếp", "Sort")}</span>
            <Segmented value={sort} onChange={setSort}
              options={[
                { value: "name", label: tr("Tên", "Name") },
                { value: "size", label: tr("Dung lượng", "Size") },
                { value: "date", label: tr("Ngày cài", "Installed") },
              ]} />
          </div>
          {list && (
            <span className="pd-muted">
              {tr(`${list.length} chương trình · ${bytes(total)}`, `${list.length} programs · ${bytes(total)}`)}
            </span>
          )}
        </div>
      </div>

      {!list ? (
        <div className="pd-empty flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> {tr("Đang đọc danh sách chương trình…", "Reading installed programs…")}</div>
      ) : (
        <div className="pd-list">
          {shown.map((p) => (
            <label key={p.key} className="pd-row cursor-pointer">
              <input type="checkbox" className="pd-check" checked={picked.has(p.key)} onChange={() => toggle(p.key)} />
              <AppIcon path={p.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                  <span className="truncate">{p.name}</span>
                  {p.broken && (
                    <span className="pd-tag shrink-0 !text-amber-300" title={tr("Windows Installer không gỡ được như bình thường (mất gói cài đặt) — PieDesk gỡ cưỡng bức được.", "Windows Installer cannot remove it normally (its package is gone) — PieDesk can force-remove it.")}>
                      <AlertTriangle size={11} /> {tr("hỏng", "broken")}
                    </span>
                  )}
                  {p.machine && <span className="pd-tag shrink-0" title={tr("Cài cho mọi người dùng — cần quyền admin", "Installed for all users — needs admin rights")}><ShieldCheck size={11} /></span>}
                </div>
                <div className="pd-muted truncate text-xs">{[p.publisher, p.version].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <span className="pd-muted hidden w-24 shrink-0 text-right text-xs sm:block">{p.installed ? new Date(p.installed).toLocaleDateString(locale()) : ""}</span>
              <span className="w-20 shrink-0 text-right text-sm tabular-nums">{p.size ? bytes(p.size) : <span className="pd-muted">—</span>}</span>
              {p.location && (
                <button className="pd-icon-btn" title={tr("Mở thư mục cài đặt", "Open install folder")} onClick={(e) => { e.preventDefault(); void ipc.openPath(p.location); }}>
                  <FolderOpen size={14} />
                </button>
              )}
              <button className="pd-icon-btn text-rose-300" title={tr("Gỡ cài đặt", "Uninstall")} onClick={(e) => { e.preventDefault(); setQueue([p]); }}>
                <Trash2 size={14} />
              </button>
            </label>
          ))}
          {shown.length === 0 && <div className="pd-empty">{tr("Không có chương trình nào khớp.", "No matching programs.")}</div>}
        </div>
      )}
    </>
  );
}

function AppIcon({ path }: { path: string }) {
  const [bad, setBad] = useState(false);
  if (!path || bad) {
    return <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/5"><Package size={15} className="pd-muted" /></span>;
  }
  return <img src={iconUrl(path, 28)} alt="" className="size-7 shrink-0 object-contain" onError={() => setBad(true)} draggable={false} />;
}

// ---------------------------------------------------------------------------------------------
// Uninstall → leftovers → done, one program after another.

type Step =
  | { kind: "confirm" }
  | { kind: "running" }
  | { kind: "waiting" } // uninstaller returned but the program is still listed
  | { kind: "msi"; code: number } // Windows Installer failed (code 0: known broken before trying)
  | { kind: "scanning" }
  | { kind: "leftovers"; items: Leftover[]; forced: boolean }
  | { kind: "removing" }
  | { kind: "done"; removed: RemoveResult[]; freed: number; error?: string };

function Flow({ queue, onClose }: { queue: Program[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>({ kind: "confirm" });
  const pickInstaller = async (prog: Program) => {
    const file = await openDialog({
      title: tr(`Chọn bộ cài ${prog.name} (cùng phiên bản)`, `Pick the ${prog.name} installer (same version)`),
      filters: [{ name: tr("Bộ cài", "Installer"), extensions: ["msi", "exe"] }],
    }).catch(() => null);
    if (typeof file === "string") void start(prog, file);
  };
  const [deep, setDeep] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<{ name: string; ok: boolean; freed: number }[]>([]);
  const cancelled = useRef(false);
  const quiet = useAdminQuiet();
  const p = queue[index];

  useEffect(() => {
    cancelled.current = false; // StrictMode mounts twice: reset after the first cleanup
    return () => void (cancelled.current = true);
  }, []);

  // Async steps finish after re-renders: read the position from a ref, not a stale closure.
  const at = useRef(0);
  const next = (entry: { ok: boolean; freed: number }) => {
    const i = at.current;
    setSummary((s) => [...s, { name: queue[i].name, ...entry }]);
    at.current = i + 1;
    setIndex(i + 1);
    if (i + 1 < queue.length) {
      setStep({ kind: "confirm" });
      // A known-broken program waits on its explanation instead of failing first.
      if (!queue[i + 1].broken) void start(queue[i + 1]);
    }
  };

  /** `force`: also the program's install folder and its Windows Installer registration. */
  const scan = async (prog: Program, force = false) => {
    if (!deep && !force) return next({ ok: true, freed: 0 });
    setStep({ kind: "scanning" });
    const items = await util.leftovers(prog, force).catch(() => [] as Leftover[]);
    if (cancelled.current) return;
    if (!items.length) return next({ ok: !force, freed: 0 });
    setPicked(new Set(items.map((i) => i.path)));
    setStep({ kind: "leftovers", items, forced: force });
  };

  /** `file`: an installer the user picked when Windows Installer lost the original. */
  const start = async (prog: Program, file?: string) => {
    setStep({ kind: "running" });
    let code = 0;
    try {
      code = await util.uninstall(prog.key, file);
    } catch (e) {
      if (cancelled.current) return;
      setStep({ kind: "done", removed: [], freed: 0, error: String(e) === "cancelled" ? tr("Đã huỷ quyền admin.", "Admin rights were declined.") : String(e) });
      return;
    }
    if (cancelled.current) return;
    // Windows Installer said no and the program is still there: explain, offer the ways out.
    if (prog.msi && !MSI_OK.includes(code) && (await util.stillInstalled(prog.key).catch(() => true))) {
      setStep({ kind: "msi", code });
      return;
    }
    // Many uninstallers hand over to a copy in %TEMP% and return at once: wait for the entry to go.
    for (let i = 0; i < 6; i++) {
      if (cancelled.current) return;
      if (!(await util.stillInstalled(prog.key).catch(() => false))) return scan(prog);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setStep({ kind: "waiting" });
  };

  // While waiting, keep checking: the uninstaller may still be on screen.
  useEffect(() => {
    if (step.kind !== "waiting") return;
    const t = setInterval(async () => {
      if (!(await util.stillInstalled(p.key).catch(() => true))) {
        clearInterval(t);
        void scan(p);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [step.kind, p]);

  const remove = async (items: Leftover[]) => {
    const chosen = items.filter((i) => picked.has(i.path));
    if (!chosen.length) return next({ ok: true, freed: 0 });
    setStep({ kind: "removing" });
    const res = await util.removeLeftovers(chosen).catch((e) => chosen.map((c) => ({ path: c.path, ok: false, error: String(e) })));
    const freed = chosen.filter((c) => res.find((r) => r.path === c.path)?.ok).reduce((s, c) => s + c.size, 0);
    setStep({ kind: "done", removed: res, freed });
  };

  if (index >= queue.length) {
    return (
      <div className="pd-hero">
        <CheckCircle2 size={40} className="shrink-0 text-emerald-300" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">{tr("Hoàn tất", "Finished")}</div>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {summary.map((s) => (
              <li key={s.name} className={clsx("flex items-center gap-1.5", !s.ok && "text-amber-300")}>
                {s.ok ? <CheckCircle2 size={13} className="text-emerald-300" /> : <AlertTriangle size={13} />}
                <span className="truncate">{s.name}</span>
                {s.freed > 0 && <span className="pd-muted">· {tr(`dọn thêm ${bytes(s.freed)}`, `${bytes(s.freed)} of leftovers`)}</span>}
              </li>
            ))}
          </ul>
          <button className="pd-btn pd-btn-primary mt-3" onClick={onClose}>{tr("Về danh sách", "Back to list")}</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pd-hero">
        <AppIconLarge program={p} spinning={step.kind === "running" || step.kind === "scanning" || step.kind === "removing" || step.kind === "waiting"} />
        <div className="min-w-0 flex-1">
          {queue.length > 1 && <div className="pd-muted text-xs uppercase tracking-wider">{tr(`Chương trình ${index + 1} / ${queue.length}`, `Program ${index + 1} of ${queue.length}`)}</div>}
          <div className="truncate text-lg font-semibold">{p.name}</div>
          <div className="pd-muted truncate text-sm">{[p.publisher, p.version, p.size ? bytes(p.size) : ""].filter(Boolean).join(" · ")}</div>
          <div className="mt-2 text-sm">
            {step.kind === "confirm" && !p.broken && (
              <>
                {queue.length > 1 && (
                  <div className="pd-muted mb-2 text-xs">{tr("Sẽ gỡ lần lượt: ", "Will uninstall in turn: ")}{queue.map((q) => q.name).join(", ")}</div>
                )}
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="pd-check" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
                  {tr("Quét phần còn sót (thư mục, registry) sau khi gỡ", "Scan for leftovers (folders, registry) afterwards")}
                </label>
                <div className="pd-muted mt-1 text-xs">{tr("PieDesk chạy trình gỡ cài đặt của chính chương trình — làm theo các bước trên cửa sổ của nó.", "PieDesk runs the program's own uninstaller — follow the steps in its window.")}</div>
              </>
            )}
            {step.kind === "confirm" && p.broken && <MsiHelp code={0} program={p} />}
            {step.kind === "msi" && <MsiHelp code={step.code} program={p} />}
            {step.kind === "running" && <span className="pd-muted">{tr("Đang chạy trình gỡ cài đặt… hoàn tất các bước trên cửa sổ của nó.", "Uninstaller running… finish the steps in its window.")}</span>}
            {step.kind === "waiting" && (
              <span className="flex items-center gap-1.5 text-amber-300"><AlertTriangle size={14} />
                {tr("Chương trình vẫn còn trong danh sách — trình gỡ còn mở, hoặc đã bị huỷ.", "The program is still listed — its uninstaller is still open, or was cancelled.")}</span>
            )}
            {step.kind === "scanning" && <span className="pd-muted">{tr("Đang tìm thư mục và khoá registry còn sót…", "Looking for leftover folders and registry keys…")}</span>}
            {step.kind === "leftovers" && (
              <span>
                {step.forced
                  ? tr(`Gỡ cưỡng bức: ${step.items.length} mục`, `Force remove: ${step.items.length} items`)
                  : tr(`Tìm thấy ${step.items.length} mục còn sót`, `Found ${step.items.length} leftovers`)} · {bytes(step.items.reduce((s, i) => s + i.size, 0))}
              </span>
            )}
            {step.kind === "removing" && <span className="pd-muted">{tr("Đang dọn…", "Removing…")}</span>}
            {step.kind === "done" && (
              step.error ? <span className="text-rose-300">{step.error}</span> : (
                <span className="flex items-center gap-1.5 text-emerald-300"><CheckCircle2 size={14} />
                  {tr(`Đã dọn ${step.removed.filter((r) => r.ok).length} mục (${bytes(step.freed)})`, `Removed ${step.removed.filter((r) => r.ok).length} items (${bytes(step.freed)})`)}</span>
              )
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {step.kind === "confirm" && !p.broken && (
              <>
                <button className="pd-btn pd-btn-primary" onClick={() => start(p)}><Trash2 size={14} /> {tr("Gỡ cài đặt", "Uninstall")}</button>
                <button className="pd-btn" onClick={onClose}><X size={14} /> {tr("Huỷ", "Cancel")}</button>
              </>
            )}
            {(step.kind === "msi" || (step.kind === "confirm" && p.broken)) && (
              <>
                <button className="pd-btn pd-btn-primary" onClick={() => pickInstaller(p)}><FileSearch size={14} /> {tr("Chọn bộ cài (.msi / .exe)…", "Pick the installer (.msi / .exe)…")}</button>
                <button className="pd-btn" onClick={() => scan(p, true)}><Hammer size={14} /> {tr("Gỡ cưỡng bức", "Force remove")}</button>
                <button className="pd-btn" onClick={() => start(p)}><RotateCcw size={14} /> {step.kind === "msi" ? tr("Thử lại", "Try again") : tr("Vẫn thử gỡ bình thường", "Try the normal uninstall")}</button>
                {step.kind === "confirm" ? (
                  <button className="pd-btn" onClick={onClose}><X size={14} /> {tr("Huỷ", "Cancel")}</button>
                ) : (
                  <button className="pd-btn" onClick={() => next({ ok: false, freed: 0 })}>{tr("Bỏ qua", "Skip")}</button>
                )}
              </>
            )}
            {step.kind === "waiting" && (
              <>
                <button className="pd-btn pd-btn-primary" onClick={() => scan(p)}><Search size={14} /> {tr("Đã gỡ xong — quét phần sót", "Done — scan leftovers")}</button>
                <button className="pd-btn" onClick={() => next({ ok: false, freed: 0 })}>{tr("Bỏ qua", "Skip")}</button>
              </>
            )}
            {step.kind === "leftovers" && (
              <>
                <button className="pd-btn pd-btn-primary" disabled={!picked.size} onClick={() => remove(step.items)}>
                  <Trash2 size={14} /> {tr(`Xoá ${picked.size} mục đã chọn`, `Remove ${picked.size} selected`)}
                </button>
                <button className="pd-btn" onClick={() => next({ ok: true, freed: 0 })}>{tr("Giữ lại", "Keep them")}</button>
              </>
            )}
            {step.kind === "done" && (
              <button className="pd-btn pd-btn-primary" onClick={() => next({ ok: !step.error, freed: step.freed })}>
                {index + 1 < queue.length ? tr("Tiếp tục", "Continue") : tr("Xong", "Finish")}
              </button>
            )}
          </div>
          {step.kind === "leftovers" && step.forced && (
            <div className="mt-2 text-xs text-amber-300">
              {tr("Xoá thư mục cài, bản đăng ký Windows Installer và mục trong danh sách chương trình. Thư mục vào Thùng rác, registry được sao lưu .reg — trả lại được.",
                "Removes the install folder, the Windows Installer registration and the Installed apps entry. Folders go to the Recycle Bin, registry is backed up (.reg) — can be undone.")}
            </div>
          )}
          {step.kind === "leftovers" && step.items.some((i) => i.admin) && !quiet && (
            <div className="pd-muted mt-2 flex items-center gap-1.5 text-xs"><ShieldCheck size={13} />
              {tr("Có mục cần quyền admin — Windows sẽ hỏi một lần.", "Some items need admin rights — Windows will ask once.")}</div>
          )}
        </div>
      </div>

      {step.kind === "leftovers" && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="pd-h2 !mb-0">{tr("Phần còn sót", "Leftovers")}</h2>
            <span className="pd-muted text-xs">{tr("Thư mục vào Thùng rác · registry được sao lưu (.reg) trước khi xoá", "Folders go to the Recycle Bin · registry is backed up (.reg) first")}</span>
          </div>
          <div className="pd-list">
            {step.items.map((l) => (
              <label key={l.path} className="pd-row cursor-pointer">
                <input type="checkbox" className="pd-check" checked={picked.has(l.path)}
                  onChange={() => setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(l.path)) n.delete(l.path);
                    else n.add(l.path);
                    return n;
                  })} />
                {l.kind === "registry" ? <Database size={15} className="pd-muted shrink-0" /> : l.kind === "folder" ? <Folder size={15} className="pd-muted shrink-0" /> : <File size={15} className="pd-muted shrink-0" />}
                <div className="min-w-0 flex-1 truncate text-xs" title={l.path}>{l.path}</div>
                {l.admin && <span className="pd-tag shrink-0"><ShieldCheck size={11} /> admin</span>}
                <span className="w-20 shrink-0 text-right text-xs tabular-nums">{l.kind === "registry" ? "" : bytes(l.size)}</span>
                {l.kind !== "registry" && (
                  <button className="pd-icon-btn" title={tr("Mở vị trí", "Show in folder")} onClick={(e) => { e.preventDefault(); void ipc.revealPath(l.path); }}>
                    <FolderOpen size={14} />
                  </button>
                )}
              </label>
            ))}
          </div>
        </section>
      )}
      {step.kind === "done" && step.removed.some((r) => !r.ok) && (
        <div className="flex flex-col gap-1 text-xs text-rose-300">
          {step.removed.filter((r) => !r.ok).map((r) => <div key={r.path} className="truncate">{r.path}: {r.error}</div>)}
        </div>
      )}
    </>
  );
}

/** Why Windows Installer could not remove the program, and what to do (buttons are in the flow). */
function MsiHelp({ code, program }: { code: number; program: Program }) {
  const busy = code === 1618;
  const unknown = code === 1605;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-amber-300"><AlertTriangle size={14} className="shrink-0" />
        {busy
          ? tr("Một bộ cài khác đang chạy — đợi nó xong rồi bấm Thử lại.", "Another installation is running — wait for it, then Try again.")
          : unknown
            ? tr("Windows Installer không còn biết sản phẩm này, chỉ còn mục trong danh sách.", "Windows Installer no longer knows this product; only its list entry is left.")
            : code === 1602
              ? tr("Trình gỡ đã bị huỷ.", "The uninstall was cancelled.")
              : code === 0
                ? tr("Bản cài này bị hỏng: Windows Installer đã mất gói cài đặt của nó.", "This installation is broken: Windows Installer lost its package.")
                : tr(`Windows Installer không gỡ được (mã ${code}).`, `Windows Installer could not uninstall it (code ${code}).`)}
      </span>
      {!busy && (
        <span className="pd-muted text-xs leading-relaxed">
          {tr(
            `Windows Installer cần file .msi gốc của ${program.name} để gỡ, nhưng file đó đã bị xoá (bộ cài giải nén nó vào thư mục Temp rồi dọn đi) — vì vậy Windows hỏi "Use source". Cách xử lý: tải bộ cài cùng phiên bản ${program.version || ""} rồi bấm Chọn bộ cài; hoặc Gỡ cưỡng bức để PieDesk xoá thư mục cài và bản đăng ký Windows Installer (có sao lưu).`,
            `Windows Installer needs ${program.name}'s original .msi to uninstall it, but that file is gone (the installer unpacked it to Temp and cleaned up) — hence the "Use source" prompt. Fix: download the same version ${program.version || ""} and Pick the installer; or Force remove to let PieDesk delete the install folder and the Windows Installer registration (backed up).`,
          )}
        </span>
      )}
    </div>
  );
}

function AppIconLarge({ program, spinning }: { program: Program; spinning: boolean }) {
  return (
    <div className="relative grid size-24 shrink-0 place-items-center rounded-2xl bg-white/5">
      {program.icon ? <img src={iconUrl(program.icon, 48)} alt="" className="size-12 object-contain" draggable={false} /> : <Package size={36} className="pd-muted" />}
      {spinning && <Loader2 size={96} strokeWidth={0.6} className="absolute inset-0 animate-spin text-[var(--pd-accent)]" />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

let cachedStore: StoreApp[] | null = null;

function StoreApps() {
  const [list, setList] = useState<StoreApp[] | null>(cachedStore);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      cachedStore = await util.storeApps();
      setList(cachedStore);
    } catch (e) {
      setError(String(e));
      setList([]);
    }
  };
  useEffect(() => {
    if (!cachedStore) void load();
  }, []);

  const remove = async (a: StoreApp) => {
    setConfirm(null);
    setBusy(a.fullName);
    try {
      await util.storeUninstall(a.fullName);
      cachedStore = (cachedStore ?? []).filter((x) => x.fullName !== a.fullName);
      setList(cachedStore);
    } catch (e) {
      setError(`${a.name}: ${e}`);
    }
    setBusy(null);
  };

  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.publisher.toLowerCase().includes(q));

  return (
    <>
      <div className="pd-section">
        <div className="flex items-center gap-2">
          <label className="relative flex flex-1 items-center">
            <Search size={14} className="pd-muted pointer-events-none absolute left-3" />
            <input className="pd-input w-full !pl-8" placeholder={tr("Tìm ứng dụng…", "Search apps…")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="pd-btn" onClick={() => { setList(null); void load(); }}><RefreshCw size={14} /></button>
        </div>
        <p className="pd-muted text-xs">{tr("Chỉ hiện ứng dụng Windows cho phép gỡ. Có thể cài lại từ Microsoft Store.", "Only apps Windows lets you remove. They can be reinstalled from the Microsoft Store.")}</p>
      </div>
      {error && <div className="text-xs text-rose-300">{error}</div>}
      {!list ? (
        <div className="pd-empty flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> {tr("Đang đọc ứng dụng Store…", "Reading Store apps…")}</div>
      ) : (
        <div className="pd-list">
          {shown.map((a) => (
            <div key={a.fullName} className="pd-row">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/5"><ShoppingBag size={14} className="pd-muted" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="pd-muted truncate text-xs">{[a.publisher, a.version].filter(Boolean).join(" · ")}</div>
              </div>
              {busy === a.fullName ? (
                <Loader2 size={15} className="animate-spin text-[var(--pd-accent)]" />
              ) : confirm === a.fullName ? (
                <span className="flex items-center gap-1.5">
                  <button className="pd-btn !py-1 text-rose-300" onClick={() => remove(a)}>{tr("Gỡ", "Remove")}</button>
                  <button className="pd-btn !py-1" onClick={() => setConfirm(null)}>{tr("Huỷ", "Cancel")}</button>
                </span>
              ) : (
                <button className="pd-icon-btn text-rose-300" title={tr("Gỡ cài đặt", "Uninstall")} disabled={!!busy} onClick={() => setConfirm(a.fullName)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {shown.length === 0 && <div className="pd-empty">{tr("Không có ứng dụng nào.", "No apps.")}</div>}
        </div>
      )}
    </>
  );
}
