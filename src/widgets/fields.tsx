import type { ReactNode } from "react";
import clsx from "clsx";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-white/60">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-white/40">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={clsx("pd-chip", value === o.value && "pd-chip-active")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" className="flex items-center justify-between gap-4 py-1 text-left text-sm" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={clsx("pd-switch", checked && "pd-switch-on")}>
        <span />
      </span>
    </button>
  );
}
