import { useEffect, useState, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";

// One shared 1 s ticker for every clock-like widget on the surface.
const subs = new Set<() => void>();
let now = Date.now();
let timer = 0;

function subscribeNow(cb: () => void) {
  subs.add(cb);
  if (!timer) {
    const tick = () => {
      now = Date.now();
      subs.forEach((f) => f());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  }
  return () => {
    subs.delete(cb);
    if (!subs.size) {
      clearTimeout(timer);
      timer = 0;
    }
  };
}

export const useNow = () => useSyncExternalStore(subscribeNow, () => now);

/** Subscribes to a Rust data-hub topic (`cpu`, `mem`, `net`, `disk`) while mounted. */
export function useHub<T>(topic: string): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    const un = listen<T>(`hub://${topic}`, ({ payload }) => setValue(payload));
    ipc.hubSubscribe(topic).catch(() => {});
    return () => {
      ipc.hubUnsubscribe(topic).catch(() => {});
      un.then((f) => f());
    };
  }, [topic]);
  return value;
}

/** Keeps the last `n` values of a series. */
export function useHistory(value: number | undefined, n = 60) {
  const [hist, setHist] = useState<number[]>([]);
  useEffect(() => {
    if (value === undefined) return;
    setHist((h) => [...h.slice(-(n - 1)), value]);
  }, [value, n]);
  return hist;
}

export const fmtBytes = (b: number) => {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
