import clsx from "clsx";
import { tr } from "../lib/i18n";
import { cellRect, flyout, LAYOUTS, snapAt } from "../lib/snap";

/**
 * The Windows 11 style snap flyout at the top of a desktop, with the zone under the cursor lit
 * and a preview of where the frame will go.
 */
export function SnapBar({ sw, sh, cx, cy }: { sw: number; sh: number; cx: number; cy: number }) {
  const f = flyout(sw);
  const hit = snapAt(sw, sh, cx, cy);
  return (
    <>
      {hit && (
        <div className="pd-snap-preview pointer-events-none fixed z-[1140]"
          style={{ left: hit.rect.x, top: hit.rect.y, width: hit.rect.w, height: hit.rect.h }} />
      )}
      <div className="pd-snap-bar pointer-events-none fixed z-[1160]" style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
        {LAYOUTS.map((layout, l) =>
          layout.map((z, i) => {
            const c = cellRect(f.tiles[l], z);
            return (
              <div key={`${l}-${i}`} className={clsx("pd-snap-cell", hit?.layout === l && hit.zone === i && "pd-snap-cell-on")}
                style={{ left: c.x - f.x, top: c.y - f.y, width: c.w, height: c.h }} />
            );
          }),
        )}
        <div className="pd-snap-label">{tr("Thả vào một vùng để xếp vào bố cục", "Drop on a zone to snap it")}</div>
      </div>
    </>
  );
}
