import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ListTodo, StickyNote, Trash2 } from "lucide-react";
import { uid } from "../lib/ipc";
import { Field, Segmented } from "./fields";
import { defineWidget } from "./types";
import { tr } from "../lib/i18n";

/** Local text state, written back to the store after the user pauses typing. */
function useDebouncedField(value: string, save: (v: string) => void, ms = 500) {
  const [text, setText] = useState(value);
  const timer = useRef(0);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setText(value);
  }, [value]);
  const change = (v: string) => {
    setText(v);
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      dirty.current = false;
      save(v);
    }, ms);
  };
  return [text, change] as const;
}

const PAPERS = { none: "", yellow: "#3a3420", pink: "#3a2430", blue: "#1f2c40", green: "#1f3529" };

type NoteConfig = { text: string; paper: keyof typeof PAPERS; fontSize: "s" | "m" | "l" };

export const notes = defineWidget<NoteConfig>({
  type: "notes",
  name: ["Ghi chú", "Notes"],
  description: ["Ghi chú nhanh, tự lưu.", "Quick sticky note, saved as you type."],
  icon: StickyNote,
  defaultSize: { w: 240, h: 200 },
  minSize: { w: 140, h: 100 },
  defaultConfig: { text: "", paper: "yellow", fontSize: "m" },

  Component: ({ config, setConfig }) => {
    const [text, change] = useDebouncedField(config.text, (t) => setConfig({ text: t }));
    return (
      <textarea
        className={clsx("pd-note h-full w-full resize-none rounded-lg bg-transparent p-2 outline-none",
          { s: "text-xs", m: "text-sm", l: "text-base" }[config.fontSize])}
        style={{ background: PAPERS[config.paper] || undefined }}
        placeholder={tr("Viết gì đó…", "Write something…")}
        value={text}
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
      />
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Field label={tr("Màu giấy", "Paper")}>
        <Segmented value={config.paper} onChange={(paper) => setConfig({ paper })}
          options={[{ value: "none", label: tr("Trong", "Clear") }, { value: "yellow", label: tr("Vàng", "Yellow") }, { value: "pink", label: tr("Hồng", "Pink") },
            { value: "blue", label: tr("Xanh", "Blue") }, { value: "green", label: tr("Lục", "Green") }]} />
      </Field>
      <Field label={tr("Cỡ chữ", "Font size")}>
        <Segmented value={config.fontSize} onChange={(fontSize) => setConfig({ fontSize })}
          options={[{ value: "s", label: tr("Nhỏ", "Small") }, { value: "m", label: tr("Vừa", "Medium") }, { value: "l", label: tr("Lớn", "Large") }]} />
      </Field>
    </>
  ),
});

type Task = { id: string; text: string; done: boolean };
type TodoConfig = { title: string; tasks: Task[]; hideDone: boolean };

export const todo = defineWidget<TodoConfig>({
  type: "todo",
  name: ["Việc cần làm", "To-do"],
  description: ["Danh sách việc, tick để hoàn thành.", "Task list, tick to complete."],
  icon: ListTodo,
  defaultSize: { w: 250, h: 230 },
  minSize: { w: 170, h: 120 },
  defaultConfig: { title: "Hôm nay", tasks: [], hideDone: false },

  Component: ({ config, setConfig }) => {
    const [draft, setDraft] = useState("");
    const tasks = config.hideDone ? config.tasks.filter((t) => !t.done) : config.tasks;
    const left = config.tasks.filter((t) => !t.done).length;
    const update = (id: string, patch: Partial<Task> | null) =>
      setConfig({ tasks: patch === null ? config.tasks.filter((t) => t.id !== id) : config.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    return (
      <div className="flex h-full flex-col p-1">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-sm font-semibold">{config.title}</span>
          <span className="text-[11px] text-white/45">{left} {tr("việc", "left")}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {tasks.map((t) => (
            <div key={t.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-white/5">
              <button className={clsx("grid size-4 shrink-0 place-items-center rounded border", t.done ? "border-[var(--pd-accent)] bg-[var(--pd-accent)]" : "border-white/30")}
                onClick={() => update(t.id, { done: !t.done })}>
                {t.done && <Check size={11} strokeWidth={3} />}
              </button>
              <span className={clsx("flex-1 text-sm", t.done && "text-white/40 line-through")}>{t.text}</span>
              <button className="opacity-0 group-hover:opacity-60 hover:!opacity-100" onClick={() => update(t.id, null)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          setConfig({ tasks: [...config.tasks, { id: uid(), text: draft.trim(), done: false }] });
          setDraft("");
        }}>
          <input className="pd-input mt-1.5 w-full !py-1 text-sm" placeholder={tr("+ Thêm việc…", "+ Add a task…")} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
      </div>
    );
  },

  Settings: ({ config, setConfig }) => (
    <>
      <Field label={tr("Tiêu đề", "Title")}>
        <input className="pd-input" value={config.title} onChange={(e) => setConfig({ title: e.target.value })} />
      </Field>
      <Segmented value={config.hideDone ? "hide" : "show"} onChange={(v) => setConfig({ hideDone: v === "hide" })}
        options={[{ value: "show", label: tr("Hiện việc đã xong", "Show done") }, { value: "hide", label: tr("Ẩn việc đã xong", "Hide done") }]} />
      <button type="button" className="pd-btn self-start" onClick={() => setConfig({ tasks: config.tasks.filter((t) => !t.done) })}>
        {tr("Xoá các việc đã xong", "Clear completed")}
      </button>
    </>
  ),
});
