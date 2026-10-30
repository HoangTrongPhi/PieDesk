import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useCapture } from "../lib/hit";
import { tr } from "../lib/i18n";

type PromptReq = { title: string; value: string; resolve: (v: string | null) => void };

const usePromptStore = create<{ req: PromptReq | null }>(() => ({ req: null }));

/** Small text prompt rendered on the surface (window.prompt is not available in WebView2 apps). */
export function prompt(title: string, value = ""): Promise<string | null> {
  return new Promise((resolve) => usePromptStore.setState({ req: { title, value, resolve } }));
}

export function PromptHost() {
  const req = usePromptStore((s) => s.req);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useCapture(!!req);

  useEffect(() => {
    if (!req) return;
    setText(req.value);
    requestAnimationFrame(() => input.current?.select());
  }, [req]);

  if (!req) return null;
  const done = (v: string | null) => {
    usePromptStore.setState({ req: null });
    req.resolve(v);
  };
  return (
    <div className="fixed inset-0 z-[1100] grid place-items-center bg-black/30" data-hit onPointerDown={() => done(null)}>
      <form
        className="pd-panel w-96 p-4"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          done(text.trim() || null);
        }}
      >
        <div className="mb-3 text-sm font-semibold">{req.title}</div>
        <input
          ref={input}
          autoFocus
          className="pd-input w-full"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && done(null)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="pd-btn" onClick={() => done(null)}>
            {tr("Huỷ", "Cancel")}
          </button>
          <button type="submit" className="pd-btn pd-btn-primary">
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
