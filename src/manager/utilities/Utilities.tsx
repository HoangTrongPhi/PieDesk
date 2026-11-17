import { useEffect, useState } from "react";
import clsx from "clsx";
import { Gauge, Loader2, PackageX, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { tr } from "../../lib/i18n";
import { CleanUp } from "./CleanUp";
import { Optimize } from "./Optimize";
import { Uninstall } from "./Uninstall";
import { useAdmin } from "../../lib/utilities";

type Tool = "cleanup" | "optimize" | "uninstall";

/** Manager → Utilities: Clean up, Uninstaller and OptimizedPC. */
export function Utilities() {
  const [tool, setTool] = useState<Tool>("cleanup");
  const tools = [
    { id: "cleanup" as const, icon: Sparkles, name: tr("Dọn dẹp", "Clean up"), sub: tr("Rác hệ thống, cache, file lớn", "Junk, caches, large files") },
    { id: "uninstall" as const, icon: PackageX, name: tr("Gỡ cài đặt", "Uninstaller"), sub: tr("Gỡ sạch chương trình & phần còn sót", "Remove programs & their leftovers") },
    { id: "optimize" as const, icon: Gauge, name: tr("Tối ưu PC", "Optimize PC"), sub: tr("Gaming · Working · Normal, khởi động", "Gaming · Working · Normal, startup") },
  ];
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{tr("Tiện ích", "Utilities")}</h1>
          <p className="pd-muted mt-1 text-sm">{tr("Dọn rác, gỡ chương trình và tối ưu Windows — mọi thay đổi đều trả lại được.", "Clean junk, remove programs and tune Windows — every change can be undone.")}</p>
        </div>
        <AdminRights />
      </div>
      <div className="mb-6 grid max-w-3xl grid-cols-3 gap-3">
        {tools.map((t) => (
          <button key={t.id} className={clsx("pd-tool", tool === t.id && "pd-tool-on")} onClick={() => setTool(t.id)}>
            <span className="pd-tool-icon"><t.icon size={18} /></span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-semibold">{t.name}</span>
              <span className="pd-muted block truncate text-xs">{t.sub}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="max-w-5xl">{tool === "cleanup" ? <CleanUp /> : tool === "uninstall" ? <Uninstall /> : <Optimize onCleanUp={() => setTool("cleanup")} />}</div>
    </>
  );
}

/**
 * Admin rights for Clean up / Uninstaller / Optimize: granted once (by the installer, or here),
 * then nothing asks UAC again. Revoking deletes PieDesk's admin helper task.
 */
function AdminRights() {
  const { status, busy, error, refresh, grant, revoke } = useAdmin();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!status) return null;
  if (status.elevated) {
    return (
      <span className="pd-admin pd-admin-on"><ShieldCheck size={14} /> {tr("PieDesk đang chạy với quyền admin", "PieDesk runs as administrator")}</span>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      {status.granted ? (
        <span className="pd-admin pd-admin-on" title={tr("Đã cấp một lần khi cài đặt — dọn dẹp, gỡ cài đặt, tối ưu và \"Chạy với quyền admin\" không hỏi UAC nữa.", "Granted once at install — clean up, uninstall, optimize and \"Run as administrator\" no longer ask UAC.")}>
          <ShieldCheck size={14} /> {tr("Quyền admin: đã cấp, không hỏi lại", "Admin rights: granted, no more prompts")}
          <button className="pd-admin-btn" disabled={busy} onClick={revoke}>{busy ? <Loader2 size={12} className="animate-spin" /> : tr("Thu hồi", "Revoke")}</button>
        </span>
      ) : (
        <span className="pd-admin" title={tr("Việc cần admin sẽ hỏi UAC mỗi lần. Cấp một lần để PieDesk không hỏi nữa.", "Admin work asks UAC every time. Grant once and PieDesk stops asking.")}>
          <ShieldAlert size={14} /> {status.revoked ? tr("Quyền admin: đã thu hồi", "Admin rights: revoked") : tr("Quyền admin: chưa cấp", "Admin rights: not granted")}
          <button className="pd-admin-btn" disabled={busy} onClick={grant}>{busy ? <Loader2 size={12} className="animate-spin" /> : tr("Cấp một lần", "Grant once")}</button>
        </span>
      )}
      {error && <span className="text-[11px] text-rose-300">{error === "cancelled" ? tr("Bạn đã từ chối hộp thoại UAC.", "The UAC prompt was declined.") : error}</span>}
    </div>
  );
}
