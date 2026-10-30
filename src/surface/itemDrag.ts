// Dragging icons inside a box, between boxes, or out of a folder portal into a shortcut box.
// HTML5 drag & drop is unavailable while Tauri's native file drop is on, so this is pointer-based.

import { create } from "zustand";
import { popCapture, pushCapture } from "../lib/hit";
import { baseName, ipc, uid } from "../lib/ipc";
import type { Item } from "../lib/types";
import { useDoc } from "../stores/doc";

type Ghost = { item: Item; x: number; y: number; fromBox: string };

export const useItemDrag = create<{ ghost: Ghost | null; overBox: string | null }>(() => ({ ghost: null, overBox: null }));

const THRESHOLD = 5;

/** Returns true from `onClickGuard` when the pointer sequence turned into a drag. */
export function beginItemPointer(e: React.PointerEvent, item: Item, fromBox: string, locked: boolean) {
  if (e.button !== 0 || locked) return;
  const sx = e.clientX;
  const sy = e.clientY;
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  let dragging = false;

  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      target.dataset.dragged = "1";
      pushCapture();
    }
    const over = boxAt(ev.clientX, ev.clientY);
    useItemDrag.setState({ ghost: { item, x: ev.clientX, y: ev.clientY, fromBox }, overBox: over?.boxId ?? null });
  };
  const up = (ev: PointerEvent) => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
    if (!dragging) return;
    useItemDrag.setState({ ghost: null, overBox: null });
    popCapture();
    // Let the click handler see `dragged` and ignore this release, then clear it.
    setTimeout(() => delete target.dataset.dragged, 0);
    const over = boxAt(ev.clientX, ev.clientY);
    if (over) dropItem(item, fromBox, over.boxId, over.index);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}

function boxAt(x: number, y: number): { boxId: string; index: number | null } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const boxEl = el?.closest<HTMLElement>("[data-box-id]");
  if (!boxEl) return null;
  const itemEl = el?.closest<HTMLElement>("[data-item-index]");
  return { boxId: boxEl.dataset.boxId!, index: itemEl ? Number(itemEl.dataset.itemIndex) : null };
}

function dropItem(item: Item, fromId: string, toId: string, index: number | null) {
  const { boxes, commit } = useDoc.getState();
  const from = boxes[fromId];
  const to = boxes[toId];
  if (!from || !to || to.kind !== "shortcuts") return;

  if (fromId === toId) {
    const items = from.items.filter((i) => i.id !== item.id);
    const at = index === null ? items.length : Math.min(index, items.length);
    items.splice(at, 0, item);
    commit([{ op: "upsert", coll: "boxes", id: fromId, value: { ...from, items, sortByName: false } }]);
    return;
  }
  // Folder portals are read-only views: dragging out gives the box its own shortcut, the file stays put.
  if (from.kind === "folder") {
    void addPathsToBox(toId, [item.path], index);
    return;
  }
  const toItems = [...to.items];
  toItems.splice(index === null ? toItems.length : index, 0, item);
  commit([
    { op: "upsert", coll: "boxes", id: toId, value: { ...to, items: toItems } },
    { op: "upsert", coll: "boxes", id: fromId, value: { ...from, items: from.items.filter((i) => i.id !== item.id) } },
  ]);
}

const key = (i: Item) => (i.source ?? i.path).toLowerCase();

/**
 * Adds paths to a shortcut box (Explorer drop, file picker, folder portal). Each one becomes the
 * box's own shortcut, so the item keeps working when the original is moved or deleted.
 */
export async function addPathsToBox(boxId: string, paths: string[], index: number | null = null) {
  const box = useDoc.getState().boxes[boxId];
  if (!box || box.kind !== "shortcuts") return;
  const known = new Set(box.items.map(key));
  const fresh: Item[] = [];
  for (const source of paths) {
    if (known.has(source.toLowerCase())) continue;
    known.add(source.toLowerCase());
    try {
      const { path, origin } = await ipc.importItem(source);
      fresh.push({ id: uid(), path, name: baseName(source), source, origin });
    } catch (e) {
      console.error(e);
    }
  }
  if (!fresh.length) return;
  // Re-read: the box may have changed while the shortcuts were being written.
  const cur = useDoc.getState().boxes[boxId];
  if (!cur) return;
  const items = [...cur.items];
  items.splice(index === null ? items.length : Math.min(index, items.length), 0, ...fresh);
  useDoc.getState().upsertBox({ ...cur, items });
}

/**
 * Brings items from older versions in line: ones that point straight at the dropped file get their
 * own shortcut, and ones that already have it take the original shortcut off the desktop.
 */
export async function adoptLegacyItems() {
  for (const box of Object.values(useDoc.getState().boxes)) {
    if (box.kind !== "shortcuts") continue;
    const updates = new Map<string, Item>();
    for (const item of box.items) {
      try {
        if (await ipc.isOwnedItem(item.path)) {
          if (item.origin || !item.source) continue;
          updates.set(item.id, { ...item, origin: await ipc.claimItem(item.path, item.source) });
        } else {
          const { path, origin } = await ipc.importItem(item.path);
          updates.set(item.id, { ...item, path, source: item.source ?? item.path, origin });
        }
      } catch {
        // Original already gone: keep the item, it still shows the fallback icon.
      }
    }
    if (!updates.size) continue;
    const cur = useDoc.getState().boxes[box.id];
    if (cur) useDoc.getState().upsertBox({ ...cur, items: cur.items.map((i) => updates.get(i.id) ?? i) });
  }
}
