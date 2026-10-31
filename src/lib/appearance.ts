import { useEffect, useState } from "react";
import { settingsWithDefaults, useDoc } from "../stores/doc";
import { seasonalTheme, themeDef, type ThemeDef } from "../themes";

/** The theme in use: the holiday one around its date (setting `seasonal`), else the chosen one. */
export function useTheme(): ThemeDef {
  const settings = settingsWithDefaults(useDoc((s) => s.settings));
  // Re-checked hourly so a holiday theme starts without a restart.
  const [season, setSeason] = useState(() => seasonalTheme());
  useEffect(() => {
    const id = setInterval(() => setSeason(seasonalTheme()), 3_600_000);
    return () => clearInterval(id);
  }, []);
  return themeDef(settings.seasonal && season ? season : settings.theme);
}

/** Mirrors theme, party mode and language onto <html> so CSS can follow them. */
export function useAppearance() {
  const settings = settingsWithDefaults(useDoc((s) => s.settings));
  const theme = useTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.id;
    root.classList.toggle("party", settings.party);
    root.lang = settings.language;
  }, [theme.id, settings.party, settings.language]);
  return theme;
}
