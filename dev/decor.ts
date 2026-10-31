// Dev gallery for src/decor (see decor.html). Shows each SVG at its viewBox size (dashed outline =
// the viewBox) and at 64 px wide, so anchors and small-size legibility can be checked.

const files = import.meta.glob("/src/decor/**/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const raw = import.meta.glob("/src/decor/**/*.svg", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

const q = new URLSearchParams(location.search);
const theme = q.get("theme");
const bg = q.get("bg");
if (bg) document.body.classList.add(bg);

const app = document.getElementById("app")!;
const byTheme = new Map<string, string[]>();
for (const path of Object.keys(files).sort()) {
  const t = path.split("/")[3];
  if (theme && t !== theme) continue;
  byTheme.set(t, [...(byTheme.get(t) ?? []), path]);
}

for (const [t, paths] of byTheme) {
  const h = document.createElement("h2");
  h.textContent = `${t} (${paths.length})`;
  app.append(h);
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const path of paths) {
    const vb = /viewBox="([^"]+)"/.exec(raw[path])?.[1] ?? "?";
    const [, , vw, vh] = vb.split(/[\s,]+/).map(Number);
    const fig = document.createElement("figure");
    const big = new Image();
    big.src = files[path];
    big.className = "big";
    if (vw && vh) {
      big.width = vw;
      big.height = vh;
    }
    const small = new Image();
    small.src = files[path];
    small.width = 64;
    const cap = document.createElement("figcaption");
    cap.textContent = `${path.split("/").pop()} · ${vb} · ${(raw[path].length / 1024).toFixed(1)} KB`;
    fig.append(big, small, cap);
    grid.append(fig);
  }
  app.append(grid);
}
if (!byTheme.size) app.textContent = "No SVG yet under src/decor" + (theme ? `/${theme}` : "");
