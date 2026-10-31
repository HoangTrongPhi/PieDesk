import { useEffect } from "react";
import { FxLayer } from "../fx/FxLayer";
import type { FxId } from "../fx";
import { useAppearance } from "../lib/appearance";
import { settingsWithDefaults, useDoc } from "../stores/doc";

/**
 * The overlay window: a click-through layer above every app on one monitor (src-tauri/src/overlays.rs)
 * showing the theme's sky effects (setting `themeOverlay`: Santa's sleigh, bat swarms, fireworks, the
 * blizzard burying the taskbar…), the chosen overlay effect and, when set to "on top", Pie the cat
 * walking on the taskbar.
 */
export function Overlay() {
  const ready = useDoc((s) => s.ready);
  const settings = settingsWithDefaults(useDoc((s) => s.settings));
  const theme = useAppearance();
  useEffect(() => void useDoc.getState().init(), []);

  // The window covers the whole monitor; the work area ends where the taskbar starts.
  const floor = Number(new URLSearchParams(location.search).get("floor")) || undefined;
  const ids: FxId[] = [];
  if (settings.fx && settings.themeOverlay) ids.push(...(theme.sky ?? []), ...(theme.overlay ?? []));
  if (settings.overlayFx !== "off") ids.push(settings.overlayFx);
  if (settings.pet === "top") ids.push("pet");
  if (!ready) return null;
  return <FxLayer ids={ids} enabled withBoxes={false} floor={floor} />;
}
