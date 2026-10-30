import { useEffect } from "react";
import { settingsWithDefaults, useDoc } from "../stores/doc";

/** Mirrors theme, party mode and language onto <html> so CSS can follow them. */
export function useAppearance() {
  const settings = settingsWithDefaults(useDoc((s) => s.settings));
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.classList.toggle("party", settings.party);
    root.lang = settings.language;
  }, [settings.theme, settings.party, settings.language]);
}
