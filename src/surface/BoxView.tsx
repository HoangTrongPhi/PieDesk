import { memo, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  File as FileIcon,
  FilePlus2,
  FolderOpen,
  FolderSearch,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { iconUrl, ipc } from "../lib/ipc";
import { startFrameDrag } from "../lib/drag";
import { locale, tr } from "../lib/i18n";
import type { BoxModel, IconSize, Item } from "../lib/types";
import { settingsWithDefaults, useDoc } from "../stores/doc";
import { useMenu, type MenuEntry } from "./ContextMenu";
import { addPathsToBox, beginItemPointer, useItemDrag } from "./itemDrag";
import { prompt } from "./Prompt";
import { useFolder } from "./useFolder";

export const ACCENTS = ["#6c8cff", "#3ec7a8", "#ffb547", "#ff6b81", "#b77cff", "#58c4ff", "#9aa4b8"];

const ICON_PX: Record<IconSize, number> = { s: 32, m: 44, l: 60 };
const CELL_W: Record<IconSize, number> = { s: 72, m: 84, l: 100 };
const HEADER_H = 34;

type Props = { box: BoxModel; bounds: { w: number; h: number }; onNewBox: (near: BoxModel) => void };

export const BoxView = memo(function BoxView({ box, bounds, onNewBox }: Props) {
  const settings = settingsWithDefaults(useDoc((s) => s.settings));
  const { patchBox, deleteBox } = useDoc.getState();
  const showMenu = useMenu((s) => s.show);
  const overBox = useItemDrag((s) => s.overBox);
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const folder = useFolder(box.kind === "folder" ? box.folder : undefined, box.filterExt);
  const source = box.kind === "folder" ? folder.items : box.items;
  const items = useMemo(() => {
    let list = source;
    if (box.kind === "shortcuts" && box.sortByName) list = [...list].sort((a, b) => a.name.localeCompare(b.name, locale()));
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [source, filter, box.kind, box.sortByName]);

  // Clamp into the monitor (resolution may have changed since the layout was saved).
  const x = Math.max(0, Math.min(box.x, bounds.w - 120));
  const y = Math.max(0, Math.min(box.y, bounds.h - HEADER_H));
  const frame = { x, y, w: box.w, h: box.h };
  const dragOpts = (mode: "move" | "resize") => ({
    grid: settings.grid,
    min: { w: 160, h: 90 },
    bounds,
    onCommit: (r: typeof frame) => patchBox(box.id, mode === "move" ? { x: r.x, y: r.y } : { w: r.w, h: r.h }),
  });

  const launch = (item: Item, admin = false) => ipc.openPath(item.path, admin || !!item.admin).catch(console.error);

  const boxMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const entries: MenuEntry[] = [
      {
        label: tr("Đổi tên box", "Rename box"),
        icon: Pencil,
        onClick: async () => {
          const t = await prompt(tr("Tên box", "Box name"), box.title);
          if (t) patchBox(box.id, { title: t });
        },
      },
      {
        label: box.collapsed ? tr("Mở rộng", "Expand") : tr("Thu gọn", "Collapse"),
        icon: box.collapsed ? ChevronDown : ChevronUp,
        onClick: () => patchBox(box.id, { collapsed: !box.collapsed }),
      },
      { kind: "sep" },
      {
        kind: "chips",
        label: tr("Hiển thị", "View"),
        options: [
          { label: tr("Lưới", "Grid"), active: box.view === "grid", onPick: () => patchBox(box.id, { view: "grid" }) },
          { label: tr("Danh sách", "List"), active: box.view === "list", onPick: () => patchBox(box.id, { view: "list" }) },
        ],
      },
      {
        kind: "chips",
        label: tr("Cỡ icon", "Icon size"),
        options: (["s", "m", "l"] as const).map((s) => ({
          label: { s: tr("Nhỏ", "S"), m: tr("Vừa", "M"), l: tr("Lớn", "L") }[s],
          active: box.iconSize === s,
          onPick: () => patchBox(box.id, { iconSize: s }),
        })),
      },
      {
        kind: "chips",
        label: tr("Nền", "Background"),
        options: [0.35, 0.6, 0.8, 0.95].map((o) => ({
          label: `${Math.round(o * 100)}%`,
          active: Math.abs(box.opacity - o) < 0.01,
          onPick: () => patchBox(box.id, { opacity: o }),
        })),
      },
      { kind: "colors", label: tr("Màu nhấn", "Accent"), colors: ACCENTS, active: box.accent, onPick: (c) => patchBox(box.id, { accent: c }) },
      { kind: "sep" },
    ];
    if (box.kind === "shortcuts") {
      entries.push(
        {
          label: tr("Thêm file / shortcut…", "Add files / shortcuts…"),
          icon: FilePlus2,
          onClick: async () => {
            const picked = await openDialog({ multiple: true, title: tr("Thêm vào box", "Add to box") });
            const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
            if (paths.length) void addPathsToBox(box.id, paths);
          },
        },
        {
          label: box.sortByName ? tr("Sắp xếp thủ công", "Manual order") : tr("Sắp xếp theo tên", "Sort by name"),
          icon: Copy,
          onClick: () => patchBox(box.id, { sortByName: !box.sortByName }),
        },
      );
    } else {
      entries.push(
        { label: tr("Mở thư mục", "Open folder"), icon: FolderOpen, onClick: () => box.folder && ipc.openPath(box.folder) },
        {
          label: tr("Đổi thư mục…", "Change folder…"),
          icon: FolderSearch,
          onClick: async () => {
            const dir = await openDialog({ directory: true, title: tr("Thư mục cho box", "Folder for this box") });
            if (typeof dir === "string") patchBox(box.id, { folder: dir });
          },
        },
        {
          label: box.filterExt?.length ? `${tr("Lọc", "Filter")}: .${box.filterExt.join(" .")}` : tr("Lọc theo đuôi file…", "Filter by extension…"),
          icon: Search,
          onClick: async () => {
            const v = await prompt(tr("Đuôi file, cách nhau bởi dấu phẩy (để trống = tất cả)", "Extensions, comma separated (empty = all)"), (box.filterExt ?? []).join(", "));
            const list = (v ?? "")
              .split(/[,\s]+/)
              .map((s) => s.replace(/^\./, "").toLowerCase())
              .filter(Boolean);
            patchBox(box.id, { filterExt: list });
          },
        },
      );
    }
    entries.push(
      { label: tr("Box mới", "New box"), icon: Plus, onClick: () => onNewBox(box) },
      { kind: "sep" },
      { label: tr("Xoá box", "Delete box"), icon: Trash2, danger: true, onClick: () => deleteBox(box.id) },
    );
    showMenu(e, entries);
  };

  const itemMenu = (e: React.MouseEvent, item: Item) => {
    e.preventDefault();
    e.stopPropagation();
    const entries: MenuEntry[] = [
      { label: tr("Mở", "Open"), icon: ExternalLink, onClick: () => launch(item) },
      { label: tr("Chạy với quyền admin", "Run as administrator"), icon: ShieldCheck, onClick: () => launch(item, true) },
      { label: tr("Mở vị trí file", "Open file location"), icon: FolderOpen, onClick: () => ipc.revealPath(item.source ?? item.path) },
    ];
    if (box.kind === "shortcuts") {
      const update = (patch: Partial<Item>) =>
        patchBox(box.id, { items: box.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)) });
      entries.push(
        { kind: "sep" },
        {
          label: tr("Đổi tên", "Rename"),
          icon: Pencil,
          onClick: async () => {
            const n = await prompt(tr("Tên hiển thị", "Display name"), item.name);
            if (n) update({ name: n });
          },
        },
        {
          kind: "chips",
          label: tr("Luôn chạy admin", "Always run as admin"),
          options: [
            { label: tr("Bật", "On"), active: !!item.admin, onPick: () => update({ admin: true }) },
            { label: tr("Tắt", "Off"), active: !item.admin, onPick: () => update({ admin: false }) },
          ],
        },
        { kind: "sep" },
        {
          label: item.origin === "moved" || item.origin === "hidden" ? tr("Trả về desktop", "Return to desktop") : tr("Xoá khỏi box", "Remove from box"),
          icon: Trash2,
          danger: true,
          onClick: () => {
            if (box.kind === "shortcuts") ipc.removeItem(item).catch(() => {});
            patchBox(box.id, { items: box.items.filter((i) => i.id !== item.id) });
          },
        },
      );
    }
    showMenu(e, entries);
  };

  const iconPx = ICON_PX[box.iconSize];
  const isList = box.view === "list";

  return (
    <div
      ref={ref}
      data-hit
      data-box-id={box.id}
      className={clsx("pd-box absolute flex flex-col", overBox === box.id && "pd-box-over")}
      style={
        {
          left: x,
          top: y,
          width: box.w,
          height: box.collapsed ? HEADER_H : box.h,
          "--accent": box.accent,
          "--box-alpha": box.opacity,
        } as React.CSSProperties
      }
      onContextMenu={boxMenu}
    >
      <header
        className={clsx("pd-box-header", !settings.locked && "cursor-grab active:cursor-grabbing")}
        style={{ height: HEADER_H }}
        onPointerDown={(e) => !settings.locked && ref.current && startFrameDrag(e, ref.current, frame, "move", dragOpts("move"))}
        onDoubleClick={() => patchBox(box.id, { collapsed: !box.collapsed })}
      >
        {filter !== null ? (
          <input
            autoFocus
            className="pd-filter"
            placeholder={tr("Lọc…", "Filter…")}
            value={filter}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter(null)}
          />
        ) : (
          <span className="pd-box-title truncate">{box.title}</span>
        )}
        <div className="pd-box-tools" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button title={filter === null ? tr("Lọc", "Filter") : tr("Đóng lọc", "Close filter")} onClick={() => setFilter(filter === null ? "" : null)}>
            {filter === null ? <Search size={13} /> : <X size={13} />}
          </button>
          <button title={tr("Tuỳ chọn", "Options")} onClick={(e) => boxMenu(e)}>
            <MoreHorizontal size={14} />
          </button>
        </div>
        {box.collapsed && <span className="pd-count">{source.length}</span>}
      </header>

      {!box.collapsed && (
        <div className={clsx("pd-box-body min-h-0 flex-1 overflow-y-auto", isList ? "flex flex-col p-1.5" : "grid content-start p-2")}
          style={isList ? undefined : { gridTemplateColumns: `repeat(auto-fill, minmax(${CELL_W[box.iconSize]}px, 1fr))` }}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              data-item-index={box.kind === "shortcuts" && !filter && !box.sortByName ? index : undefined}
              className={clsx("pd-item", isList && "pd-item-list")}
              title={item.path}
              onPointerDown={(e) => beginItemPointer(e, item, box.id, settings.locked)}
              onClick={(e) => {
                if ((e.currentTarget as HTMLElement).dataset.dragged) return;
                if (settings.launchMode === "single") launch(item);
              }}
              onDoubleClick={() => settings.launchMode === "double" && launch(item)}
              onContextMenu={(e) => itemMenu(e, item)}
            >
              <ItemIcon path={item.path} px={isList ? 20 : iconPx} admin={!!item.admin} link={box.kind === "shortcuts" || LINK_EXT.test(item.path)} />
              {(settings.showLabels || isList) && <span className="pd-item-label">{item.name}</span>}
            </button>
          ))}
          {items.length === 0 && (
            <div className="col-span-full grid place-items-center px-3 py-6 text-center text-xs text-white/45">
              {box.kind === "folder"
                ? folder.error ?? (box.folder ? tr("Thư mục trống", "Folder is empty") : tr("Chưa chọn thư mục", "No folder selected"))
                : filter
                  ? tr("Không có kết quả", "No results")
                  : tr("Kéo file, thư mục hoặc shortcut vào đây", "Drop files, folders or shortcuts here")}
            </div>
          )}
        </div>
      )}

      {!box.collapsed && !settings.locked && (
        <div
          className="pd-resize"
          onPointerDown={(e) => ref.current && startFrameDrag(e, ref.current, frame, "resize", dragOpts("resize"))}
        />
      )}
    </div>
  );
});

const LINK_EXT = /\.(lnk|url|pif)$/i;

/** Shell icon plus Windows-style badges: shortcut arrow (bottom left), run as admin (bottom right). */
function ItemIcon({ path, px, admin, link }: { path: string; px: number; admin: boolean; link: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: px, height: px }}>
      {failed ? (
        <FileIcon size={px * 0.8} strokeWidth={1.2} className="text-white/60" />
      ) : (
        <img
          src={iconUrl(path, px)}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          alt=""
        />
      )}
      {link && px >= 28 && (
        <span className="pd-link-badge">
          <ArrowUpRight size={Math.round(px * 0.22)} strokeWidth={3} />
        </span>
      )}
      {admin && <ShieldCheck size={12} className="absolute -right-1 -bottom-1 rounded bg-amber-500 p-px text-black" />}
    </span>
  );
}
