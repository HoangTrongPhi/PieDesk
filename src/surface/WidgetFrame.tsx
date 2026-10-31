import { memo, useRef, useState } from "react";
import clsx from "clsx";
import { Copy, GripHorizontal, Monitor, Settings2, Trash2, X } from "lucide-react";
import { startFrameDrag } from "../lib/drag";
import { tr, tx } from "../lib/i18n";
import { useCapture } from "../lib/hit";
import { uid } from "../lib/ipc";
import type { WidgetModel } from "../lib/types";
import { settingsWithDefaults, useDoc } from "../stores/doc";
import { displayName, placeOn, useSurface } from "../stores/surface";
import { widgetDef } from "../widgets/registry";
import { useMenu, type MenuEntry } from "./ContextMenu";

type Props = { widget: WidgetModel; bounds: { w: number; h: number } };

export const WidgetFrame = memo(function WidgetFrame({ widget, bounds }: Props) {
  const def = widgetDef(widget.type);
  const settings = settingsWithDefaults(useDoc((s) => s.settings));
  const { patchWidget, deleteWidget, upsertWidget } = useDoc.getState();
  const showMenu = useMenu((s) => s.show);
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const info = useSurface((s) => s.info);

  if (!def) return null;
  const x = Math.max(0, Math.min(widget.x, bounds.w - 60));
  const y = Math.max(0, Math.min(widget.y, bounds.h - 40));
  const frame = { x, y, w: widget.w, h: widget.h };
  const config = { ...def.defaultConfig, ...widget.config };
  const setConfig = (patch: Record<string, unknown>) => patchWidget(widget.id, { config: { ...config, ...patch } });
  const drag = (e: React.PointerEvent, mode: "move" | "resize") =>
    ref.current &&
    startFrameDrag(e, ref.current, frame, mode, {
      grid: settings.grid,
      min: def.minSize,
      bounds,
      onCommit: (r) =>
        patchWidget(widget.id, mode === "move" ? { x: r.x, y: r.y, monitor: info?.monitor ?? widget.monitor } : { w: r.w, h: r.h }),
      cross: {
        frame: { coll: "widgets", id: widget.id, title: tx(def.name) },
        onLand: (monitor, at) => patchWidget(widget.id, { monitor, ...at }),
      },
    });
  const moveTo: MenuEntry[] = (info?.displays ?? [])
    .filter((d) => d.id !== info?.monitor)
    .map((d) => ({
      label: `${tr("Chuyển sang", "Move to")} ${displayName(d)}`,
      icon: Monitor,
      onClick: () => patchWidget(widget.id, { monitor: d.id, ...placeOn(frame, info!, d) }),
    }));

  const menu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("textarea, input")) return; // keep the native text menu
    e.preventDefault();
    showMenu(e, [
      ...(def.Settings ? [{ label: tr("Cài đặt widget", "Widget settings"), icon: Settings2, onClick: () => setEditing(true) }] : []),
      {
        kind: "chips",
        label: tr("Nền", "Background"),
        options: [0, 0.35, 0.6, 0.85].map((o) => ({
          label: o === 0 ? tr("Trong", "Clear") : `${Math.round(o * 100)}%`,
          active: Math.abs((widget.opacity ?? 0.6) - o) < 0.01,
          onPick: () => patchWidget(widget.id, { opacity: o }),
        })),
      },
      { label: tr("Nhân bản", "Duplicate"), icon: Copy, onClick: () => upsertWidget({ ...widget, id: uid(), x: x + 24, y: y + 24 }) },
      ...moveTo,
      { kind: "sep" },
      { label: tr("Xoá widget", "Delete widget"), icon: Trash2, danger: true, onClick: () => deleteWidget(widget.id) },
    ]);
  };

  return (
    <>
      <div
        ref={ref}
        data-hit
        data-widget-id={widget.id}
        className={clsx("pd-widget group absolute", (widget.opacity ?? 0.6) === 0 && "pd-widget-bare")}
        style={{ left: x, top: y, width: widget.w, height: widget.h, "--box-alpha": widget.opacity ?? 0.6 } as React.CSSProperties}
        onContextMenu={menu}
      >
        <div className="h-full w-full overflow-hidden p-2.5">
          <def.Component config={config} setConfig={setConfig} size={{ w: widget.w, h: widget.h }} />
        </div>
        {!settings.locked && (
          <>
            <div className="pd-widget-bar">
              <button className="cursor-grab active:cursor-grabbing" title={tr("Kéo để di chuyển", "Drag to move")} onPointerDown={(e) => drag(e, "move")}>
                <GripHorizontal size={14} />
              </button>
              {def.Settings && (
                <button title={tr("Cài đặt", "Settings")} onClick={() => setEditing(true)}>
                  <Settings2 size={13} />
                </button>
              )}
            </div>
            <div className="pd-resize" onPointerDown={(e) => drag(e, "resize")} />
          </>
        )}
      </div>
      {editing && def.Settings && (
        <WidgetSettings title={tx(def.name)} onClose={() => setEditing(false)}>
          <def.Settings config={config} setConfig={setConfig} size={{ w: widget.w, h: widget.h }} />
        </WidgetSettings>
      )}
    </>
  );
});

function WidgetSettings({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useCapture(true);
  return (
    <div className="fixed inset-0 z-[1050] grid place-items-center bg-black/30" data-hit onPointerDown={onClose}>
      <div className="pd-panel flex max-h-[80vh] w-[380px] flex-col" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <span className="text-sm font-semibold">{title}</span>
          <button className="pd-icon-btn" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
