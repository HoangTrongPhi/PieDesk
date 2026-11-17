import agents from "./agents";
import calendar from "./calendar";
import clock from "./clock";
import gpu from "./gpu";
import { countdown, web } from "./media";
import { notes, todo } from "./notes";
import nowplaying from "./nowplaying";
import { player } from "./player";
import { disks, sysmon } from "./sysmon";
import type { WidgetDef } from "./types";
import weather from "./weather";

/** Every widget type, in gallery order. Add a new widget by defining it and listing it here. */
export const WIDGETS: WidgetDef[] = [weather, agents, clock, calendar, nowplaying, sysmon, gpu, disks, notes, todo, player, countdown, web];

export const widgetDef = (type: string) => WIDGETS.find((w) => w.type === type);
