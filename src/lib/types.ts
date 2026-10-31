export type Rect = { x: number; y: number; w: number; h: number };

export type Item = {
  id: string;
  path: string;
  name: string;
  /** Always run as administrator. */
  admin?: boolean;
  /** What the item was made from; `path` is the box's own shortcut to it (see src-tauri/src/items.rs). */
  source?: string;
  /** What happened to `source`: a shortcut moved into the box, or hidden when it could not be moved. */
  origin?: ItemOrigin;
};

export type ItemOrigin = "moved" | "hidden" | "kept";

export type BoxKind = "shortcuts" | "folder";
export type BoxView = "grid" | "list";
export type IconSize = "s" | "m" | "l";

export type BoxModel = Rect & {
  id: string;
  kind: BoxKind;
  title: string;
  /** Monitor key from SurfaceInfo; unknown keys fall back to the primary monitor. */
  monitor: string;
  collapsed?: boolean;
  view: BoxView;
  iconSize: IconSize;
  accent: string;
  opacity: number;
  items: Item[];
  /** Folder portal: the mirrored folder. */
  folder?: string;
  /** Folder portal: only these extensions (lowercase, no dot). Empty = all. */
  filterExt?: string[];
  sortByName?: boolean;
  /** App group this box was made for ("Group apps into boxes"); new installs of it land here. */
  group?: string;
};

export type WidgetModel = Rect & {
  id: string;
  type: string;
  monitor: string;
  config: Record<string, unknown>;
  opacity?: number;
};

export type Settings = {
  initialized?: boolean;
  locked?: boolean;
  launchMode?: "single" | "double";
  grid?: number;
  hotkey?: string;
  pauseOnFullscreen?: boolean;
  showLabels?: boolean;
  language?: "vi" | "en";
  theme?: ThemeId;
  /** RGB LED strip chasing around every box and widget. */
  party?: boolean;
  /** Windows toast when a Claude / Antigravity session finishes. */
  agentNotify?: boolean;
  /** Look for a new PieDesk version in the background. */
  autoUpdate?: boolean;
  /** Monitor id that seeds the layout, gets new boxes and hosts orphans. Empty = Windows primary. */
  homeMonitor?: string;
  /** Holiday themes switch on by themselves around Tết, Trung thu, Halloween and Christmas. */
  seasonal?: boolean;
  /** Canvas effects of the theme (snow, petals…). */
  fx?: boolean;
  /** Stop effects while on battery. */
  fxBattery?: boolean;
  /** Effect drawn above every app, in its own click-through window. */
  overlayFx?: OverlayFx;
  /** Pie the cat: on the desktop (walks on boxes), on top of every app, or off. */
  pet?: "off" | "desktop" | "top";
  /** Newly installed programs drop into the box of their group. */
  autoGroup?: boolean;
  /** Program key → group id picked by the user. */
  appGroupOverrides?: Record<string, string>;
  /** Program keys already offered to group boxes, so removed ones do not come back. */
  appsSeen?: string[];
};

export type { ThemeId } from "../themes";
import type { ThemeId } from "../themes";
import type { OverlayFx } from "../fx";

export type Coll = "boxes" | "widgets";

export type Op =
  | { op: "upsert"; coll: Coll; id: string; value: BoxModel | WidgetModel }
  | { op: "delete"; coll: Coll; id: string }
  | { op: "settings"; value: Partial<Settings> };

export type Doc = {
  rev: number;
  settings: Settings;
  boxes: Record<string, BoxModel>;
  widgets: Record<string, WidgetModel>;
};

export type Display = {
  id: string;
  /** EDID name; may be empty. */
  name: string;
  index: number;
  /** PieDesk's home monitor. */
  primary: boolean;
  windowsPrimary: boolean;
  width: number;
  height: number;
};

export type SurfaceInfo = {
  label: string;
  monitor: string;
  /** This surface is on the home monitor. */
  primary: boolean;
  monitors: string[];
  displays: Display[];
  width: number;
  height: number;
};

/** A box / widget being dragged towards another monitor (see src-tauri/src/surfaces.rs). */
export type DragFrame = { coll: Coll; id: string; title: string; w: number; h: number; grabX: number; grabY: number };

export type FolderEntry = { name: string; path: string; isDir: boolean; ext: string };

export type AppGroup = { id: string; vi: string; en: string };
export type CatalogApp = { key: string; name: string; link: string; onDesktop: boolean; group: string; guess: string };
export type Catalog = { groups: AppGroup[]; apps: CatalogApp[] };
