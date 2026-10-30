import type { FC } from "react";
import type { LucideIcon } from "lucide-react";
import type { Text } from "../lib/i18n";

export type WidgetProps<C> = {
  config: C;
  setConfig: (patch: Partial<C>) => void;
  size: { w: number; h: number };
};

export type WidgetDef<C extends Record<string, unknown> = Record<string, unknown>> = {
  type: string;
  name: Text;
  description: Text;
  icon: LucideIcon;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  defaultConfig: C;
  Component: FC<WidgetProps<C>>;
  /** Rendered in the widget's settings dialog. */
  Settings?: FC<WidgetProps<C>>;
};

export const defineWidget = <C extends Record<string, unknown>>(def: WidgetDef<C>) => def as unknown as WidgetDef;
