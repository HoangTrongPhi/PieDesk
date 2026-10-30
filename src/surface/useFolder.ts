import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import type { Item } from "../lib/types";

/** Live contents of a folder portal box. */
export function useFolder(folder: string | undefined, filterExt: string[] | undefined) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const filterKey = (filterExt ?? []).join(",");

  useEffect(() => {
    if (!folder) return;
    let alive = true;
    const filter = filterKey ? new Set(filterKey.split(",")) : null;
    const load = () =>
      ipc
        .listFolder(folder)
        .then((entries) => {
          if (!alive) return;
          setError(null);
          setItems(
            entries
              .filter((e) => !filter || e.isDir || filter.has(e.ext))
              .map((e) => ({ id: e.path, path: e.path, name: e.name })),
          );
        })
        .catch((e) => alive && setError(String(e)));
    load();
    ipc.watchFolder(folder).catch(() => {});
    const un = listen<string>("folder://changed", ({ payload }) => payload === folder && load());
    return () => {
      alive = false;
      ipc.unwatchFolder(folder).catch(() => {});
      un.then((f) => f());
    };
  }, [folder, filterKey]);

  return { items, error };
}
