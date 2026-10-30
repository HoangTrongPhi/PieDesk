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
};

export type ThemeId = "neon" | "midnight" | "aurora" | "ember";

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

export type SurfaceInfo = {
  label: string;
  monitor: string;
  primary: boolean;
  monitors: string[];
  width: number;
  height: number;
};

export type FolderEntry = { name: string; path: string; isDir: boolean; ext: string };
