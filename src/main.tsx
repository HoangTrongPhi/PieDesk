import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Surface } from "./surface/Surface";
import { Manager } from "./manager/Manager";

async function boot() {
  // Plain browser (vite dev without Tauri): fake backend so the UI can be previewed.
  if (!("__TAURI_INTERNALS__" in window)) await (await import("./dev/mock")).installMock();

  const view = new URLSearchParams(location.search).get("view") ?? "manager";
  document.documentElement.dataset.view = view;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>{view === "surface" ? <Surface /> : <Manager />}</StrictMode>,
  );
}

boot();
