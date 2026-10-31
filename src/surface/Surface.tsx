import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { iconUrl, ipc, uid } from "../lib/ipc";
import { useHitReporter } from "../lib/hit";
import type { BoxModel, SurfaceInfo, WidgetModel } from "../lib/types";
import { systemLang, useDoc } from "../stores/doc";
import { initSurfaceInfo, useSurface } from "../stores/surface";
import { addNewApps } from "../lib/groups";
import { useAppearance } from "../lib/appearance";
import { FxLayer } from "../fx/FxLayer";
import { DECOR_FX, type FxId } from "../fx";
import { DecorLayer } from "../decor/DecorLayer";
import { tr } from "../lib/i18n";
import { widgetDef } from "../widgets/registry";
import { ACCENTS, BoxView } from "./BoxView";
import { ContextMenuHost } from "./ContextMenu";
import { addPathsToBox, adoptLegacyItems, useItemDrag } from "./itemDrag";
import { PromptHost } from "./Prompt";
import { WidgetFrame } from "./WidgetFrame";

export function newBox(monitor: string, at: { x: number; y: number }, patch: Partial<BoxModel> = {}): BoxModel {
  const count = Object.keys(useDoc.getState().boxes).length;
  return {
    id: uid(),
    kind: "shortcuts",
    title: tr("Box mới", "New box"),
    monitor,
    x: at.x,
    y: at.y,
    w: 420,
    h: 260,
    view: "grid",
    iconSize: "m",
    accent: ACCENTS[count % ACCENTS.length],
    opacity: 0.6,
    items: [],
    ...patch,
  };
}

export function newWidget(type: string, monitor: string, at: { x: number; y: number }): WidgetModel | null {
  const def = widgetDef(type);
  if (!def) return null;
  return { id: uid(), type, monitor, x: at.x, y: at.y, ...def.defaultSize, config: { ...def.defaultConfig }, opacity: 0.6 };
}

let seeded = false;
let adopted = false;
const adoptOnce = () => {
  if (adopted) return;
  adopted = true;
  return adoptLegacyItems();
};

/** First run on the primary monitor: an empty Apps box to drop shortcuts into, plus a few widgets. */
async function seed(info: SurfaceInfo) {
  if (seeded) return;
  seeded = true;
  const { commit } = useDoc.getState();
  const right = info.width - 300;
  const ops: Parameters<typeof commit>[0] = [];
  const add = (coll: "boxes" | "widgets", value: BoxModel | WidgetModel) => ops.push({ op: "upsert", coll, id: value.id, value });
  add("boxes", newBox(info.monitor, { x: 32, y: 32 }, { title: tr("Ứng dụng", "Apps"), accent: ACCENTS[1], w: 520, h: 300 }));
  const clock = newWidget("clock", info.monitor, { x: right, y: 32 });
  const weather = newWidget("weather", info.monitor, { x: 32, y: info.height - 290 });
  const agents = newWidget("agents", info.monitor, { x: right - 40, y: 176 });
  if (clock) add("widgets", { ...clock, w: 260 });
  if (weather) add("widgets", weather);
  if (agents) add("widgets", agents);
  ops.push({ op: "settings", value: { initialized: true, language: systemLang() } });
  commit(ops);
}

type Ghost = { id: string; title: string; x: number; y: number; w: number; h: number };

export function Surface() {
  const info = useSurface((s) => s.info);
  const [dropGhost, setDropGhost] = useState<Ghost | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ w: window.innerWidth, h: window.innerHeight });
  const { ready, boxes, widgets, settings } = useDoc();
  const ghost = useItemDrag((s) => s.ghost);
  useHitReporter(root);
  const theme = useAppearance();

  useEffect(() => {
    initSurfaceInfo();
    useDoc.getState().init();
    // A box or widget dragged here from another monitor.
    const un = listen<Ghost | null>("drag://ghost", ({ payload }) => setDropGhost(payload));
    const onResize = () => setBounds({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!ready || !info?.primary) return;
    if (!settings.initialized) return void seed(info);
    void adoptOnce();
    // Layouts from before the language setting: pin the system language so the tray can follow it.
    if (!settings.language) useDoc.getState().setSettings({ language: systemLang() });
  }, [ready, info, settings.initialized, settings.language]);

  // Programs installed while PieDesk runs (and since it last ran) drop into their group box.
  useEffect(() => {
    if (!ready || !info?.primary || !settings.initialized) return;
    const run = () => void addNewApps().catch(console.error);
    run();
    const un = listen("apps://changed", run);
    return () => void un.then((f) => f());
  }, [ready, info?.primary, settings.initialized]);

  // Tray → "Thêm Box": the primary surface creates it.
  useEffect(() => {
    if (!info?.primary) return;
    const un = listen("cmd://add-box", () => useDoc.getState().upsertBox(newBox(info.monitor, { x: 80, y: 80 })));
    return () => void un.then((f) => f());
  }, [info]);

  // Files dragged from Explorer onto a box.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "over" || payload.type === "drop") {
        const dpr = window.devicePixelRatio;
        const el = document.elementFromPoint(payload.position.x / dpr, payload.position.y / dpr);
        const boxId = el?.closest<HTMLElement>("[data-box-id]")?.dataset.boxId ?? null;
        if (payload.type === "over") useItemDrag.setState({ overBox: boxId });
        else {
          useItemDrag.setState({ overBox: null });
          if (boxId) void addPathsToBox(boxId, payload.paths);
        }
      } else {
        useItemDrag.setState({ overBox: null });
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // The overlay window (above every app) and the wallpaper follow the theme in use; the home
  // surface tells the backend, which opens/closes the overlays and swaps the wallpaper.
  const skyOnTop = settings.fx !== false && settings.themeOverlay !== false;
  const wantOverlay = skyOnTop && !!(theme.sky?.length || theme.overlay?.length);
  const wantWallpaper = settings.themeWallpaper !== false && theme.wallpaper ? theme.id : null;
  useEffect(() => {
    if (!ready || !info?.primary) return;
    ipc.themeEffects(wantOverlay, wantWallpaper).catch(console.error);
  }, [ready, info?.primary, wantOverlay, wantWallpaper]);
  const layoutKey = useMemo(() => ({}), [boxes, widgets]);

  if (!info || !ready) return null;
  const mine = (monitor: string) => monitor === info.monitor || (info.primary && !info.monitors.includes(monitor));
  const onNewBox = (near: BoxModel) =>
    useDoc.getState().upsertBox(newBox(info.monitor, { x: Math.min(near.x + 40, bounds.w - 420), y: Math.min(near.y + 40, bounds.h - 260) }));

  const decor = settings.decor !== false;
  const fx: FxId[] = [
    ...(settings.fx === false ? [] : [...(theme.fx ?? []), ...(skyOnTop ? [] : (theme.sky ?? []))]).filter((id) => decor || !DECOR_FX.has(id)),
    ...(settings.pet === "desktop" ? (["pet"] as const) : []),
  ];

  return (
    <div ref={setRoot} className="pd-surface fixed inset-0">
      <FxLayer ids={fx} enabled />
      {decor && theme.scene && <DecorLayer groups={theme.scene} home={info.primary} bounds={bounds} layoutKey={layoutKey} />}
      {Object.values(widgets)
        .filter((w) => mine(w.monitor))
        .map((w) => <WidgetFrame key={w.id} widget={w} bounds={bounds} />)}
      {Object.values(boxes)
        .filter((b) => mine(b.monitor))
        .map((b) => <BoxView key={b.id} box={b} bounds={bounds} onNewBox={onNewBox} />)}
      {dropGhost && (
        <div className="pd-drop-ghost pointer-events-none fixed z-[1150]"
          style={{ left: dropGhost.x, top: dropGhost.y, width: dropGhost.w, height: dropGhost.h }}>
          <span className="truncate">{dropGhost.title}</span>
        </div>
      )}
      {ghost && (
        <div className="pd-ghost pointer-events-none fixed z-[1200]" style={{ left: ghost.x - 24, top: ghost.y - 24 }}>
          <img src={iconUrl(ghost.item.path, 48)} width={48} height={48} alt="" />
        </div>
      )}
      <ContextMenuHost />
      <PromptHost />
    </div>
  );
}
