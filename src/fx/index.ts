import { aquarium, matrix, stars, synthGrid } from "./scenes";
import { bats, fireworks, lanterns } from "./festive";
import { pet } from "./pet";
import { compose, type FxDef } from "./types";
import { fireflies, leaves, petals, rain, rainGlass, snow } from "./weather";

export const FX = {
  snow: () => snow(),
  sakura: () => petals(),
  leaves,
  rain: () => rain(),
  rainGlass,
  fireflies: () => fireflies(),
  matrix,
  synthGrid,
  stars,
  aquarium,
  bats: () => bats(),
  lanterns: () => lanterns(),
  tet: () => compose("front", petals({ count: 36, colors: ["#facc15", "#fde047", "#fbbf24", "#f9a8d4"] }), fireworks()),
  christmas: () => snow({ count: 110 }),
  pet,
} satisfies Record<string, () => FxDef>;

export type FxId = keyof typeof FX;

/** Effects the overlay window (above all apps) can show. */
export const OVERLAY_FX = ["snow", "sakura", "leaves", "rain", "fireflies", "lanterns"] as const satisfies readonly FxId[];
export type OverlayFx = (typeof OVERLAY_FX)[number] | "off";
