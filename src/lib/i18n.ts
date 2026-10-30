// Two languages, picked in Settings (default: the system language).
// Strings live next to the code that uses them: tr("Xoá", "Delete").
// Components re-render on a language change because they subscribe to `settings`.

import { settingsWithDefaults, useDoc } from "../stores/doc";

export type Lang = "vi" | "en";
/** A translatable label kept as data (widget names, option lists): [vi, en]. */
export type Text = readonly [vi: string, en: string];

export const lang = (): Lang => settingsWithDefaults(useDoc.getState().settings).language;
export const tr = (vi: string, en: string) => (lang() === "vi" ? vi : en);
export const tx = (t: Text) => tr(t[0], t[1]);
export const locale = () => (lang() === "vi" ? "vi-VN" : "en-US");
/** Subscribes the calling component to language changes. */
export const useLang = () => useDoc((s) => s.settings.language);
