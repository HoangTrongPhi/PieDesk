import { useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useCapture } from "../lib/hit";

export type MenuEntry =
  | { kind?: "action"; label: string; icon?: LucideIcon; danger?: boolean; onClick: () => void }
  | { kind: "sep" }
  | { kind: "chips"; label: string; options: { label: string; active: boolean; onPick: () => void }[] }
  | { kind: "colors"; label: string; colors: string[]; active: string; onPick: (c: string) => void };

type MenuState = {
  open: { x: number; y: number; entries: MenuEntry[] } | null;
  show: (e: { clientX: number; clientY: number }, entries: MenuEntry[]) => void;
  close: () => void;
};

export const useMenu = create<MenuState>((set) => ({
  open: null,
  show: (e, entries) => set({ open: { x: e.clientX, y: e.clientY, entries } }),
  close: () => set({ open: null }),
}));

export function ContextMenuHost() {
  const { open, close } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useCapture(!!open);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(open.x, window.innerWidth - r.width - 8),
      y: Math.min(open.y, window.innerHeight - r.height - 8),
    });
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000]"
      data-hit
      onPointerDown={close}
      onContextMenu={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div
        ref={ref}
        className="pd-menu absolute min-w-56 max-w-80 py-1.5"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {open.entries.map((entry, i) => {
          if (entry.kind === "sep") return <div key={i} className="my-1 h-px bg-white/8" />;
          if (entry.kind === "chips")
            return (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px]">
                <span className="text-white/60">{entry.label}</span>
                <div className="flex gap-1">
                  {entry.options.map((o) => (
                    <button
                      key={o.label}
                      className={clsx("pd-chip", o.active && "pd-chip-active")}
                      onClick={() => {
                        o.onPick();
                        close();
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          if (entry.kind === "colors")
            return (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px]">
                <span className="text-white/60">{entry.label}</span>
                <div className="flex gap-1.5">
                  {entry.colors.map((c) => (
                    <button
                      key={c}
                      className={clsx("size-4 rounded-full ring-offset-1 ring-offset-[#1b1f2b]", entry.active === c && "ring-2 ring-white")}
                      style={{ background: c }}
                      onClick={() => {
                        entry.onPick(c);
                        close();
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          const Icon = entry.icon;
          return (
            <button
              key={i}
              className={clsx("pd-menu-item", entry.danger && "text-rose-300")}
              onClick={() => {
                close();
                entry.onClick();
              }}
            >
              {Icon ? <Icon size={15} strokeWidth={1.8} className="opacity-80" /> : <span className="w-[15px]" />}
              {entry.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
