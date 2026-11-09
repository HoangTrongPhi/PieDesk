import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Copy, FileText, Globe, Link, Mail, MapPin, X } from "lucide-react";
import { AUTHOR } from "../lib/author";
import { ipc } from "../lib/ipc";

/*
 * About & contact: the same blueprint dialog as the Abyss apps (Poseidon / Coral `AboutDialog`),
 * ported to PieDesk's own CSS (`.pd-about*` in styles.css) since PieDesk doesn't use @abyss/ui.
 * The blueprint colors stay fixed across PieDesk themes, like the other apps.
 */

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Isometric projection of a room-space point (x, y on the floor, z up; 0..1). */
function iso(x: number, y: number, z: number): [number, number] {
  const s = 92;
  return [100 + (x - y) * 0.866 * s, 70 + (x + y) * 0.5 * s - z * s * 0.95];
}

function poly(...pts: [number, number, number][]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${iso(...p).map((v) => v.toFixed(1)).join(" ")}`).join(" ");
}

/** Floor, two walls, a window, a shelf, a desk with a monitor, and a chair: a nod to the portfolio's room. */
const ROOM: string[] = [
  poly([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]),
  poly([1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 1], [0, 1, 0]),
  poly([0, 0, 0], [0, 0, 1]),
  poly([0, 0.3, 0.45], [0, 0.72, 0.45], [0, 0.72, 0.82], [0, 0.3, 0.82], [0, 0.3, 0.45]),
  poly([0, 0.51, 0.45], [0, 0.51, 0.82]),
  poly([0.55, 0, 0.66], [0.9, 0, 0.66], [0.9, 0.12, 0.66], [0.55, 0.12, 0.66]),
  poly([0.12, 0, 0.34], [0.62, 0, 0.34], [0.62, 0.26, 0.34], [0.12, 0.26, 0.34], [0.12, 0, 0.34]),
  poly([0.12, 0.26, 0.34], [0.12, 0.26, 0]),
  poly([0.62, 0.26, 0.34], [0.62, 0.26, 0]),
  poly([0.62, 0, 0.34], [0.62, 0, 0]),
  poly([0.22, 0.04, 0.38], [0.5, 0.04, 0.38], [0.5, 0.04, 0.56], [0.22, 0.04, 0.56], [0.22, 0.04, 0.38]),
  poly([0.36, 0.06, 0.34], [0.36, 0.06, 0.38]),
  poly([0.28, 0.36, 0.2], [0.46, 0.36, 0.2], [0.46, 0.54, 0.2], [0.28, 0.54, 0.2], [0.28, 0.36, 0.2]),
  poly([0.28, 0.54, 0.2], [0.28, 0.54, 0.44], [0.46, 0.54, 0.44], [0.46, 0.54, 0.2]),
  poly([0.37, 0.45, 0.2], [0.37, 0.45, 0.02]),
];

function Wireframe() {
  return (
    <svg viewBox="0 0 200 190" className="h-full w-full" aria-hidden="true">
      <g className="pd-about-wire" fill="none" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {ROOM.map((d, i) => (
          <path key={i} d={d} pathLength={1} className="pd-about-draw" style={{ animationDelay: `${i * 70}ms` } as CSSProperties} />
        ))}
      </g>
    </svg>
  );
}

function LinkRow({ icon, label, title, onClick }: { icon: ReactNode; label: string; title?: string; onClick: () => void }) {
  return (
    <button type="button" className="pd-about-link group" onClick={onClick} title={title}>
      <span className="pd-about-link-icon">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <ArrowUpRight size={12} className="opacity-0 group-hover:opacity-100" />
    </button>
  );
}

export function AboutDialog({ open, onClose, version, onCheckUpdates }: {
  open: boolean;
  onClose: () => void;
  version?: string;
  onCheckUpdates?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const author = AUTHOR;
  const go = (url: string) => void ipc.openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});
  const linkedin = author.links.find((l) => l.kind === "linkedin");

  return (
    <div className="pd-about-backdrop" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="about-title" className="pd-about" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pd-about-hero relative flex items-center gap-2 px-6 py-5">
          <button type="button" className="pd-about-close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
          <div className="h-44 w-48 shrink-0">
            <Wireframe />
          </div>
          <div className="min-w-0 flex-1">
            <div className="pd-about-kicker">// about · contact</div>
            <h2 id="about-title" className="pd-about-name">{author.name}</h2>
            <div className="pd-about-role">{author.role}</div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-[#9fb6d6]">
              {author.location && (
                <span className="flex items-center gap-1">
                  <MapPin size={14} className="pd-about-dim" /> {author.location}
                </span>
              )}
              {author.availability && (
                <span className="pd-about-avail">
                  <span className="pd-about-pulse" /> {author.availability}
                </span>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {author.website && (
                <>
                  <button type="button" className="pd-about-cta" onClick={() => go(author.website)} title={author.website}>
                    <Globe size={14} /> Visit portfolio <ArrowUpRight size={14} />
                  </button>
                  <button type="button" className="pd-about-icon-btn" title="Copy portfolio link" aria-label="Copy portfolio link" onClick={() => copy(author.website)}>
                    <Copy size={14} />
                  </button>
                </>
              )}
              {linkedin && (
                <button type="button" className="pd-about-ghost" onClick={() => go(linkedin.url)}>
                  <Link size={14} /> Message on LinkedIn
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-5 px-6 py-5 md:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-4">
            {author.bio && <p className="pd-muted text-[13px] leading-relaxed">{author.bio}</p>}
            {author.highlights.length > 0 && (
              <div>
                <div className="pd-about-label">Selected work</div>
                <ul className="flex flex-col gap-1">
                  {author.highlights.map((h) => (
                    <li key={h.title} className="flex items-baseline gap-2 text-[12.5px]">
                      <span className="pd-about-dot" />
                      <span className="font-medium">{h.title}</span>
                      <span className="pd-muted truncate">
                        {h.studio} · {h.years}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {author.skills.map((s) => (
                <span key={s} className="pd-about-chip">{s}</span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 md:w-48">
            <div className="pd-about-label">Find me on</div>
            {author.links.map((l) => (
              <LinkRow key={l.url} icon={<Link size={14} />} label={l.label} title={host(l.url)} onClick={() => go(l.url)} />
            ))}
            {author.cv && <LinkRow icon={<FileText size={14} />} label="Full portfolio (PDF)" onClick={() => go(author.cv)} />}
            {author.email && <LinkRow icon={<Mail size={14} />} label={author.email} onClick={() => go(`mailto:${author.email}`)} />}
          </div>
        </div>

        <div className="pd-about-foot">
          <span>
            PieDesk — Desktop boxes & widgets {version ? `v${version}` : ""} · built by {author.handle}
          </span>
          <span className="flex items-center gap-3">
            {onCheckUpdates && (
              <button type="button" className="pd-about-update" onClick={onCheckUpdates}>
                Check for updates
              </button>
            )}
            <span className="font-mono">Tauri 2 · Rust · React</span>
          </span>
        </div>
      </div>
    </div>
  );
}
