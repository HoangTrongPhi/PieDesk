import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GripHorizontal, PinOff, Settings2, X } from "lucide-react";
import { tr, tx } from "../lib/i18n";
import { useAppearance } from "../lib/appearance";
import { useDoc } from "../stores/doc";
import { widgetDef } from "../widgets/registry";
import { WIDGET_DROP, type WidgetDrop } from "./itemDrag";
import { WidgetBoundary } from "./WidgetBoundary";

/**
 * A floating widget (src-tauri/src/pins.rs): the whole window is the widget, above every app,
 * like PureRef. Drag the bar to move, the corner to resize; the new place is written back to the
 * widget, so "unpin" puts it on the desktop where the window was.
 */
export function Pin() {
  const id = new URLSearchParams(location.search).get("id") ?? "";
  const widget = useDoc((s) => s.widgets[id]);
  const ready = useDoc((s) => s.ready);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [editing, setEditing] = useState(false);
  useAppearance();

  useEffect(() => {
    void useDoc.getState().init();
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Moved or resized by the user: store the new place once it settles.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let t = 0;
    const later = () => {
      clearTimeout(t);
      t = window.setTimeout(() => void invoke("pin_commit").catch(console.error), 350);
    };
    const win = getCurrentWindow();
    const a = win.onMoved(later);
    const b = win.onResized(later);
    return () => {
      clearTimeout(t);
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, []);

  // Files from Explorer and links from a browser (src-tauri/src/dropzone.rs), like on the desktop.
  useEffect(() => {
    const un = listen<{ kind: string; paths: string[]; url: string | null }>("drop://event", ({ payload: p }) => {
      if (p.kind === "drop") window.dispatchEvent(new CustomEvent<WidgetDrop>(WIDGET_DROP, { detail: { id, paths: p.paths, url: p.url } }));
    });
    return () => void un.then((f) => f());
  }, [id]);

  const def = widget && widgetDef(widget.type);
  if (!ready || !widget || !def) return null;
  const config = { ...def.defaultConfig, ...widget.config };
  const { patchWidget } = useDoc.getState();
  const setConfig = (patch: Record<string, unknown>) => patchWidget(widget.id, { config: { ...config, ...patch } });
  const win = () => getCurrentWindow();

  return (
    <div
      className="pd-widget pd-pin group fixed inset-0"
      data-widget-id={widget.id}
      style={{ "--box-alpha": widget.opacity ?? 0.6 } as React.CSSProperties}
    >
      <div className="h-full w-full overflow-hidden p-2.5">
        <WidgetBoundary name={tx(def.name)}>
          <def.Component config={config} setConfig={setConfig} size={size} id={widget.id} />
        </WidgetBoundary>
      </div>
      <div className="pd-widget-bar">
        <button className="cursor-grab active:cursor-grabbing" title={tr("Kéo để di chuyển", "Drag to move")}
          onPointerDown={(e) => {
            if (e.button === 0) void win().startDragging();
          }}>
          <GripHorizontal size={14} />
        </button>
        {def.Settings && (
          <button title={tr("Cài đặt", "Settings")} onClick={() => setEditing(true)}><Settings2 size={13} /></button>
        )}
        <button title={tr("Bỏ ghim — đưa về desktop", "Unpin — back to the desktop")} onClick={() => setConfig({ onTop: false })}>
          <PinOff size={13} />
        </button>
      </div>
      <div className="pd-resize" onPointerDown={(e) => {
        if (e.button === 0) void win().startResizeDragging("SouthEast");
      }} />
      {editing && def.Settings && (
        <div className="pd-pin-settings">
          <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
            <span className="text-sm font-semibold">{tx(def.name)}</span>
            <button className="pd-icon-btn" onClick={() => setEditing(false)}><X size={15} /></button>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto p-3">
            <def.Settings config={config} setConfig={setConfig} size={size} />
          </div>
        </div>
      )}
    </div>
  );
}
