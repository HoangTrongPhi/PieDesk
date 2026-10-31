import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { allGroups, fillGroupBoxes, groupLabel } from "../lib/groups";
import { tr } from "../lib/i18n";
import { ipc } from "../lib/ipc";
import type { Catalog, Display } from "../lib/types";
import { settingsWithDefaults, useDoc } from "../stores/doc";
import { Toggle } from "../widgets/fields";

/** Scan installed programs, review their groups, then make one box per group. */
export function AppGroups({ home }: { home: Display | undefined }) {
  const settings = settingsWithDefaults(useDoc((s) => s.settings));
  const setSettings = useDoc((s) => s.setSettings);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [state, setState] = useState<"idle" | "scanning" | "placing" | string>("idle");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  const scan = async () => {
    setState("scanning");
    try {
      const c = await ipc.appCatalog(settings.appGroupOverrides);
      setCat(c);
      setPicked(new Set(c.apps.map((a) => a.group).filter((g) => g !== "other")));
      setState("idle");
    } catch (e) {
      setState(String(e));
    }
  };

  const regroup = (key: string, group: string) => {
    if (!cat) return;
    setCat({ ...cat, apps: cat.apps.map((a) => (a.key === key ? { ...a, group } : a)) });
    const overrides = { ...settings.appGroupOverrides };
    const guess = cat.apps.find((a) => a.key === key)?.guess;
    if (group === guess) delete overrides[key];
    else overrides[key] = group;
    setSettings({ appGroupOverrides: overrides });
  };

  const create = async () => {
    if (!cat) return;
    setState("placing");
    // An empty monitor id shows on the home monitor (see Surface).
    const n = await fillGroupBoxes(cat, [...picked], "", { w: home?.width ?? 1920, h: home?.height ?? 1040 });
    setCat(null);
    setState(tr(`Đã xếp ${n} ứng dụng vào box theo nhóm.`, `Placed ${n} apps into group boxes.`));
  };

  const groups = cat ? allGroups(cat).map((g) => ({ g, apps: cat.apps.filter((a) => a.group === g.id) })).filter((x) => x.apps.length) : [];
  const total = groups.filter((x) => picked.has(x.g.id)).reduce((n, x) => n + x.apps.length, 0);

  return (
    <section className="pd-section mb-8">
      <div className="flex flex-wrap items-center gap-3">
        <Layers size={18} className="pd-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{tr("Gom nhóm ứng dụng", "Group apps")}</div>
          <div className="pd-muted text-xs">
            {tr(
              "Tự nhận diện Code Editor, IDE, Game Engine, 3D, Design… rồi tạo mỗi nhóm một box. Shortcut trên desktop được chuyển vào box, shortcut Start Menu được sao chép.",
              "Detects code editors, IDEs, game engines, 3D, design apps… and makes one box per group. Desktop shortcuts move in, Start Menu ones are copied.",
            )}
          </div>
        </div>
        <button className="pd-btn" disabled={state === "scanning" || state === "placing"} onClick={scan}>
          {state === "scanning" ? tr("Đang quét…", "Scanning…") : cat ? tr("Quét lại", "Scan again") : tr("Quét ứng dụng", "Scan apps")}
        </button>
      </div>

      {cat && (
        <>
          <div className="pd-list mt-3">
            {groups.map(({ g, apps }) => (
              <div key={g.id} className="flex flex-col">
                <div className="pd-row">
                  <input type="checkbox" checked={picked.has(g.id)} className="accent-[var(--pd-accent)]"
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(g.id);
                      else next.delete(g.id);
                      setPicked(next);
                    }} />
                  <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm" onClick={() => setOpen(open === g.id ? null : g.id)}>
                    {open === g.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="font-medium">{groupLabel(g)}</span>
                    <span className="pd-muted truncate text-xs">· {apps.map((a) => a.name).join(", ")}</span>
                  </button>
                  <span className="pd-muted text-xs">{apps.length}</span>
                </div>
                {open === g.id && (
                  <div className="flex flex-col gap-1 py-1 pl-9 pr-2">
                    {apps.map((a) => (
                      <div key={a.key} className="flex items-center gap-2 text-xs">
                        <span className={clsx("min-w-0 flex-1 truncate", a.group !== a.guess && "text-[var(--pd-accent)]")} title={a.key}>
                          {a.name}
                        </span>
                        <select className="pd-input py-0.5 text-xs" value={a.group} onChange={(e) => regroup(a.key, e.target.value)}>
                          {allGroups(cat).map((o) => <option key={o.id} value={o.id}>{groupLabel(o)}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {groups.length === 0 && <div className="pd-empty">{tr("Mọi ứng dụng đã nằm trong box.", "Every app is already in a box.")}</div>}
          </div>
          {groups.length > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <button className="pd-btn pd-btn-primary" disabled={!total || state === "placing"} onClick={create}>
                {state === "placing" ? tr("Đang tạo…", "Creating…") : tr(`Tạo box theo nhóm (${total} app)`, `Create group boxes (${total} apps)`)}
              </button>
              <span className="pd-muted text-xs">{tr("Nhóm đã có box thì app được thêm vào box đó.", "Groups that already have a box get the apps added there.")}</span>
            </div>
          )}
        </>
      )}
      {!["idle", "scanning", "placing"].includes(state) && <p className="pd-muted mt-2 text-xs">{state}</p>}
      <div className="mt-3">
        <Toggle label={tr("Ứng dụng mới cài tự vào đúng box của nhóm", "Newly installed apps drop into their group's box")}
          checked={settings.autoGroup} onChange={(autoGroup) => setSettings({ autoGroup })} />
      </div>
    </section>
  );
}
