import { useState } from "react";
import clsx from "clsx";
import { Gauge, Sparkles } from "lucide-react";
import { tr } from "../../lib/i18n";
import { CleanUp } from "./CleanUp";
import { Optimize } from "./Optimize";

type Tool = "cleanup" | "optimize";

/** Manager → Utilities: Clean up and OptimizedPC. */
export function Utilities() {
  const [tool, setTool] = useState<Tool>("cleanup");
  const tools = [
    { id: "cleanup" as const, icon: Sparkles, name: tr("Dọn dẹp", "Clean up"), sub: tr("Rác hệ thống, cache, file lớn", "Junk, caches, large files") },
    { id: "optimize" as const, icon: Gauge, name: tr("Tối ưu PC", "Optimize PC"), sub: tr("Gaming · Working · Normal, khởi động", "Gaming · Working · Normal, startup") },
  ];
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{tr("Tiện ích", "Utilities")}</h1>
        <p className="pd-muted mt-1 text-sm">{tr("Dọn rác và tối ưu Windows — mọi thay đổi đều trả lại được.", "Clean junk and tune Windows — every change can be undone.")}</p>
      </div>
      <div className="mb-6 grid max-w-2xl grid-cols-2 gap-3">
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
      <div className="max-w-5xl">{tool === "cleanup" ? <CleanUp /> : <Optimize onCleanUp={() => setTool("cleanup")} />}</div>
    </>
  );
}
