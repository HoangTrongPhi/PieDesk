// "Group apps into boxes": one shortcut box per app group (code editors, IDEs, engines, 3D…),
// filled from the catalog Rust builds (src-tauri/src/catalog.rs). Boxes remember their group, so
// a program installed later drops into the right one.

import { tr } from "./i18n";
import { baseName, ipc, uid } from "./ipc";
import type { AppGroup, BoxModel, Catalog, CatalogApp, Item, Rect } from "./types";
import { settingsWithDefaults, useDoc } from "../stores/doc";
import { ACCENTS } from "../surface/BoxView";
import { newBox } from "../surface/Surface";

export const OTHER: AppGroup = { id: "other", vi: "Khác", en: "Other" };
export const groupLabel = (g: AppGroup) => tr(g.vi, g.en);
export const allGroups = (cat: Catalog) => [...cat.groups, OTHER];

const BOX = { w: 360, h: 230 };

async function toItems(apps: CatalogApp[]): Promise<Item[]> {
  const items: Item[] = [];
  for (const app of apps) {
    try {
      const { path, origin } = await ipc.takeApp(app.link, app.onDesktop);
      items.push({ id: uid(), path, name: baseName(app.link), source: app.link, origin });
    } catch (e) {
      console.error(e);
    }
  }
  return items;
}

/** First grid spot (24 px steps, left to right, top to bottom) that overlaps nothing in `taken`. */
function freeSpot(taken: Rect[], bounds: { w: number; h: number }): { x: number; y: number } {
  const hits = (x: number, y: number) =>
    taken.some((r) => x < r.x + r.w + 16 && x + BOX.w + 16 > r.x && y < r.y + r.h + 16 && y + BOX.h + 16 > r.y);
  for (let y = 32; y + BOX.h <= bounds.h; y += 24) for (let x = 32; x + BOX.w <= bounds.w; x += 24) if (!hits(x, y)) return { x, y };
  return { x: 32 + taken.length * 24, y: 32 + taken.length * 24 };
}

const markSeen = (keys: string[]) => {
  const { settings, setSettings } = useDoc.getState();
  const seen = new Set(settingsWithDefaults(settings).appsSeen);
  keys.forEach((k) => seen.add(k));
  setSettings({ appsSeen: [...seen] });
};

/**
 * Puts the catalog's apps of `groupIds` into their group boxes, making the boxes that are missing
 * on `monitor` (whose usable size is `bounds`). Returns how many apps were placed.
 */
export async function fillGroupBoxes(cat: Catalog, groupIds: string[], monitor: string, bounds: { w: number; h: number }) {
  let placed = 0;
  for (const g of allGroups(cat).filter((g) => groupIds.includes(g.id))) {
    const apps = cat.apps.filter((a) => a.group === g.id);
    if (!apps.length) continue;
    const items = await toItems(apps);
    placed += items.length;
    const { boxes, upsertBox } = useDoc.getState();
    const existing = Object.values(boxes).find((b) => b.kind === "shortcuts" && b.group === g.id);
    if (existing) {
      upsertBox({ ...existing, items: [...existing.items, ...items] });
      continue;
    }
    const here = [...Object.values(boxes), ...Object.values(useDoc.getState().widgets)].filter((b) => b.monitor === monitor || !b.monitor);
    const count = Object.keys(boxes).length;
    upsertBox(
      newBox(monitor, freeSpot(here, bounds), { title: groupLabel(g), group: g.id, ...BOX, items, accent: ACCENTS[count % ACCENTS.length] }),
    );
  }
  markSeen(cat.apps.map((a) => a.key));
  return placed;
}

/** Newly installed programs (not seen before) go into the existing box of their group. */
export async function addNewApps() {
  const settings = settingsWithDefaults(useDoc.getState().settings);
  const groupBoxes = Object.values(useDoc.getState().boxes).filter((b): b is BoxModel & { group: string } => !!b.group);
  if (!settings.autoGroup || !groupBoxes.length) return;
  const cat = await ipc.appCatalog(settings.appGroupOverrides);
  const seen = new Set(settings.appsSeen);
  const fresh = cat.apps.filter((a) => !seen.has(a.key) && groupBoxes.some((b) => b.group === a.group));
  for (const box of groupBoxes) {
    const items = await toItems(fresh.filter((a) => a.group === box.group));
    const cur = useDoc.getState().boxes[box.id];
    if (items.length && cur) useDoc.getState().upsertBox({ ...cur, items: [...cur.items, ...items] });
  }
  markSeen(cat.apps.map((a) => a.key));
}
