// Every theme: its CSS tokens live in styles.css / themes.css under :root[data-theme=<id>], its
// canvas effects (if any) are listed here. Seasonal themes switch on by themselves around their
// holiday when the `seasonal` setting is on.

import type { FxId } from "../fx";
import type { Text } from "../lib/i18n";
import { lunarToSolar } from "../lib/lunar";

export type ThemeKind = "basic" | "special" | "seasonal";

export type ThemeDef = {
  id: string;
  name: string;
  desc: Text;
  kind: ThemeKind;
  /** Preview swatch colours, mirroring the CSS tokens. */
  panel: string;
  border: string;
  accent: string;
  /** Canvas effects only this theme has. */
  fx?: FxId[];
};

export const THEMES = [
  { id: "neon", name: "Neon Room", kind: "basic", desc: ["HUD sci-fi, chữ mono, viền xanh neon", "Sci-fi HUD, mono type, neon cyan edges"], panel: "#061225", border: "#4f8fcf", accent: "#66e0ff" },
  { id: "midnight", name: "Midnight", kind: "basic", desc: ["Kính tối gọn gàng, mặc định cũ", "Clean dark glass, the original look"], panel: "#0e111b", border: "#2a2f3c", accent: "#6c8cff" },
  { id: "aurora", name: "Aurora", kind: "basic", desc: ["Tím hồng ấm, viền gradient", "Warm violet and pink, gradient edges"], panel: "#1a0f2e", border: "#7b4bc4", accent: "#ff6bd6" },
  { id: "ember", name: "Ember", kind: "basic", desc: ["Than hồng cam ấm, hợp hình nền tối", "Warm amber glow for dark wallpapers"], panel: "#1e100a", border: "#a8642f", accent: "#ffb547" },
  { id: "glass", name: "Fluent Glass", kind: "basic", desc: ["Kính mờ Acrylic kiểu Windows 11", "Frosted Acrylic glass like Windows 11"], panel: "#20263a", border: "#5d6577", accent: "#60cdff" },
  { id: "light", name: "Minimal Light", kind: "basic", desc: ["Sáng, sạch, hợp hình nền sáng", "Bright and clean for light wallpapers"], panel: "#f6f7fa", border: "#d4d6dc", accent: "#2563eb" },
  { id: "nord", name: "Nord", kind: "basic", desc: ["Xanh băng Bắc Âu dịu mắt", "Calm arctic blue-grey"], panel: "#2e3440", border: "#4c566a", accent: "#88c0d0" },
  { id: "dracula", name: "Dracula", kind: "basic", desc: ["Tím hồng quen thuộc của dân code", "The coder's purple and pink"], panel: "#282a36", border: "#6272a4", accent: "#bd93f9" },
  { id: "catppuccin", name: "Catppuccin", kind: "basic", desc: ["Pastel mềm, bo tròn", "Soft pastels, round corners"], panel: "#1e1e2e", border: "#585b70", accent: "#cba6f7" },
  { id: "paper", name: "Paper", kind: "basic", desc: ["Giấy kẻ dòng, chữ viết tay", "Ruled paper, handwritten titles"], panel: "#faf4e4", border: "#9c8664", accent: "#c2410c" },

  { id: "cyberpunk", name: "Cyberpunk", kind: "special", desc: ["Góc vát, tiêu đề glitch tách RGB khi hover", "Cut corners, titles glitch and split RGB on hover"], panel: "#0e0a18", border: "#fcee0a", accent: "#ff006e" },
  { id: "matrix", name: "Matrix", kind: "special", desc: ["Mưa ký tự chạy trong nền box", "Digital rain inside every box"], panel: "#000a02", border: "#00a84a", accent: "#00ff66", fx: ["matrix"] },
  { id: "synthwave", name: "Synthwave", kind: "special", desc: ["Mặt trời neon và lưới chân trời chuyển động", "Neon sun over a scrolling horizon grid"], panel: "#1a0630", border: "#ff38c8", accent: "#ffb347", fx: ["synthGrid"] },
  { id: "sakura", name: "Sakura", kind: "special", desc: ["Cánh hoa anh đào rơi, đậu và trượt trên box", "Cherry petals fall, land and slide off boxes"], panel: "#341a28", border: "#ffb7d5", accent: "#ffb7d5", fx: ["sakura"] },
  { id: "winter", name: "Winter", kind: "special", desc: ["Tuyết đọng trên nóc box, viền băng giá", "Snow piles on boxes, frosted edges"], panel: "#122238", border: "#c8ecff", accent: "#bfeaff", fx: ["snow"] },
  { id: "aquarium", name: "Aquarium", kind: "special", desc: ["Bong bóng trong box, cá bơi giữa các box", "Bubbles in boxes, fish swimming between them"], panel: "#042236", border: "#5eead4", accent: "#5eead4", fx: ["aquarium"] },
  { id: "galaxy", name: "Galaxy", kind: "special", desc: ["Bầu trời sao dịch theo chuột, sao băng", "Stars that shift with the pointer, shooting stars"], panel: "#08061a", border: "#a78bfa", accent: "#a78bfa", fx: ["stars"] },
  { id: "retro", name: "Retro Pixel", kind: "special", desc: ["Màn CRT, scanline, viền pixel", "CRT scanlines and pixel borders"], panel: "#101018", border: "#ffd60a", accent: "#ffd60a" },
  { id: "lofi", name: "Lofi Rain", kind: "special", desc: ["Giọt mưa đọng và chảy trên kính box, thỉnh thoảng có sấm", "Raindrops bead and run down the glass, the odd lightning"], panel: "#1e2230", border: "#94a3b8", accent: "#f9a8d4", fx: ["rainGlass"] },
  { id: "steampunk", name: "Steampunk", kind: "special", desc: ["Đồng thau, đinh tán, bánh răng quay khi dùng box", "Brass and rivets; the gear turns while you use a box"], panel: "#281a0e", border: "#cda05a", accent: "#d4a24c" },

  { id: "halloween", name: "Halloween", kind: "seasonal", desc: ["Dơi bay, bí ngô — tự bật 24/10 → 1/11", "Bats and pumpkins — on by itself Oct 24 → Nov 1"], panel: "#160a1c", border: "#ff7a18", accent: "#ff7a18", fx: ["bats"] },
  { id: "christmas", name: "Giáng sinh", kind: "seasonal", desc: ["Tuyết và dây đèn nhấp nháy — 15/12 → 26/12", "Snow and twinkling lights — Dec 15 → 26"], panel: "#0c2418", border: "#ef4444", accent: "#facc15", fx: ["christmas"] },
  { id: "tet", name: "Tết", kind: "seasonal", desc: ["Hoa mai đào rơi, pháo hoa — quanh Tết Nguyên Đán", "Apricot blossoms and fireworks — around Lunar New Year"], panel: "#3c0808", border: "#facc15", accent: "#facc15", fx: ["tet"] },
  { id: "midautumn", name: "Trung thu", kind: "seasonal", desc: ["Đèn lồng bay, trăng rằm — quanh Rằm tháng Tám", "Rising lanterns and a full moon — around Mid-Autumn"], panel: "#0e1430", border: "#fbbf24", accent: "#fbbf24", fx: ["lanterns"] },
] as const satisfies readonly ThemeDef[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const themeDef = (id: string): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES[0];

// Lunar holidays (Tết, Trung thu) are computed for any year by ../lib/lunar.
/** [month, day] in solar year `y` of a lunar date of lunar year `y`. */
const lunar = (y: number, day: number, month: number): [number, number] | undefined => {
  const d = lunarToSolar(day, month, y);
  return d ? [d[1], d[0]] : undefined;
};

const DAY = 86_400_000;
const near = (now: Date, md: [number, number] | undefined, before: number, after: number) => {
  if (!md) return false;
  const day = new Date(now.getFullYear(), md[0] - 1, md[1]).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return today >= day - before * DAY && today <= day + after * DAY;
};

/** The holiday theme for `now`, if any. */
export function seasonalTheme(now = new Date()): ThemeId | null {
  const y = now.getFullYear();
  if (near(now, lunar(y, 1, 1), 7, 7)) return "tet";
  if (near(now, lunar(y, 15, 8), 5, 2)) return "midautumn";
  if (near(now, [10, 31], 7, 1)) return "halloween";
  if (near(now, [12, 20], 5, 6)) return "christmas";
  return null;
}
