import { aquarium, matrix, stars, synthGrid } from "./scenes";
import { batSwarm, bats, clouds, fireworks, fog, ghosts, lanterns, sleigh, spiderDrop, witch } from "./festive";
import { hangers, trim } from "./ornaments";
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
  lanterns: () => lanterns(),
  pet,

  // Christmas
  christmas: () => snow({ count: 120, crystals: 22 }),
  xmasTrim: () => trim({ corner: { left: "christmas/holly", w: 40, chance: 0.8 }, strip: { asset: "christmas/icicles", h: 13 } }),
  xmasHang: () =>
    hangers({
      assets: { "christmas/bauble-red": 22, "christmas/bauble-gold": 22, "christmas/bauble-blue": 22, "christmas/candy-cane": 15, "christmas/stocking": 26, "christmas/wreath": 34 },
      spacing: 120,
      chance: 0.6,
      len: [10, 46],
      string: "rgb(250 204 21 / 0.65)",
    }),
  sleigh,
  blizzard: () => snow({ count: 150, crystals: 36, pile: false, drift: true, gusts: true }),

  // Halloween
  bats: () => bats(),
  fog,
  ghosts,
  hwTrim: () =>
    trim({ corner: { left: "halloween/web-corner", w: 58, chance: 0.75, alpha: 0.85, inset: 0 }, sit: { assets: ["halloween/pumpkin-mini"], w: 30, chance: 0.45 } }),
  hwHang: () =>
    hangers({ assets: { "halloween/spider": 24, "halloween/candy": 18 }, spacing: 190, chance: 0.5, len: [30, 90], string: "rgb(233 227 245 / 0.55)", climber: "halloween/spider" }),
  batSwarm: () => batSwarm(),
  witch,
  spiderDrop: () => spiderDrop(),

  // Tết
  tet: () => compose("front", petals({ count: 36, size: [5, 8], sprites: ["tet/flower-mai", "tet/flower-mai", "tet/flower-dao"] }), fireworks()),
  tetTrim: () => trim({ corner: { left: "tet/mai-sprig", right: "tet/dao-sprig", w: 56, chance: 0.75, inset: -4 } }),
  tetHang: () =>
    hangers({
      assets: { "tet/li-xi-1": 20, "tet/li-xi-2": 20, "tet/lantern-red": 24, "tet/firecrackers": 18 },
      spacing: 120,
      chance: 0.6,
      len: [8, 36],
      string: "rgb(250 204 21 / 0.7)",
    }),
  /** Above every app: a volley now and then, and a real show at giao thừa. */
  tetSky: () => fireworks({ every: [45, 100], volley: 1, midnight: true }),

  // Trung thu
  clouds,
  maHang: () =>
    hangers({
      assets: {
        "midautumn/den-ong-sao": 34,
        "midautumn/den-ca-chep": 40,
        "midautumn/den-tho": 32,
        "midautumn/lantern-round-red": 20,
        "midautumn/lantern-round-yellow": 20,
        "midautumn/lantern-round-pink": 20,
      },
      spacing: 130,
      chance: 0.6,
      len: [10, 40],
      string: "rgb(253 230 138 / 0.6)",
    }),
} satisfies Record<string, () => FxDef>;

export type FxId = keyof typeof FX;

/** Ornaments on boxes: part of the theme decor (setting `decor`). */
export const DECOR_FX: ReadonlySet<FxId> = new Set<FxId>(["xmasTrim", "xmasHang", "hwTrim", "hwHang", "tetTrim", "tetHang", "maHang"]);

/** Effects the overlay window (above all apps) can show. */
export const OVERLAY_FX = ["snow", "sakura", "leaves", "rain", "fireflies", "lanterns"] as const satisfies readonly FxId[];
export type OverlayFx = (typeof OVERLAY_FX)[number] | "off";
