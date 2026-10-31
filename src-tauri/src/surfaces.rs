//! One surface window per monitor, kept in step with the display setup.
//!
//! `sync` diffs the connected monitors against the open surfaces: a new monitor gets a surface,
//! an unplugged one loses it, a moved / rescaled one is re-placed. Boxes of an unplugged monitor
//! keep their monitor id and coordinates, so the home surface shows them (clamped) until the
//! monitor comes back and they return on their own.
//!
//! The home monitor (setting `homeMonitor`, empty = the Windows primary display) seeds the first
//! layout, receives new boxes and hosts orphans.
//!
//! Dragging between monitors: each surface is its own WebView, so a box cannot leave its window.
//! While the pointer is outside the source surface, `drag_over` finds the surface under the
//! cursor and tells it to draw a ghost; `drag_end` returns where the box lands on it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::store::{Coll, Op};
use crate::{desktop, hittest, monitors, AppState, OpsEvent, SURFACE_PREFIX};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: String,
    /// EDID name; may be empty (the UI then says "Display <index + 1>").
    pub name: String,
    pub index: usize,
    /// The home monitor of PieDesk.
    pub primary: bool,
    pub windows_primary: bool,
    /// Work area in CSS px.
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceInfo {
    pub label: String,
    pub monitor: String,
    pub primary: bool,
    pub monitors: Vec<String>,
    pub displays: Vec<Display>,
    pub width: f64,
    pub height: f64,
}

static NEXT_LABEL: AtomicUsize = AtomicUsize::new(0);

/// Brings the surfaces in line with the connected monitors.
pub fn sync(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let monitors = app.available_monitors()?;
    let windows_primary = app.primary_monitor()?.and_then(|m| m.name().cloned());
    let identities = monitors::identities();
    let home_setting = state.store.read(|d| d.setting_str("homeMonitor")).unwrap_or_default();

    let mut displays: Vec<Display> = monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let gdi = m.name().cloned();
            let ident = gdi.as_ref().and_then(|g| identities.get(g));
            let area = m.work_area();
            Display {
                id: monitor_id(m, i, &identities),
                name: ident.map(|x| x.name.clone()).unwrap_or_default(),
                index: i,
                primary: false,
                windows_primary: gdi.is_some() && gdi == windows_primary,
                width: area.size.width as f64 / m.scale_factor(),
                height: area.size.height as f64 / m.scale_factor(),
            }
        })
        .collect();
    let home = displays
        .iter()
        .position(|d| d.id == home_setting)
        .or_else(|| displays.iter().position(|d| d.windows_primary))
        .unwrap_or(0);
    if let Some(d) = displays.get_mut(home) {
        d.primary = true;
    }

    migrate_gdi_names(app, &monitors, &displays);

    // Plan outside the lock: building or closing a window waits on the main thread, where
    // `surface_info` takes the same lock.
    let open: Vec<(String, String)> =
        state.surfaces.lock().unwrap().values().map(|s| (s.label.clone(), s.monitor.clone())).collect();
    for (label, monitor) in &open {
        if !displays.iter().any(|d| &d.id == monitor) {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.destroy();
            }
            state.hit.remove(label);
        }
    }
    let ids: Vec<String> = displays.iter().map(|d| d.id.clone()).collect();
    let mut infos = HashMap::new();
    for (d, m) in displays.iter().zip(&monitors) {
        let label = match open.iter().find(|(_, mon)| mon == &d.id) {
            Some((label, _)) => label.clone(),
            None => format!("{SURFACE_PREFIX}{}", NEXT_LABEL.fetch_add(1, Ordering::Relaxed)),
        };
        infos.insert(
            label.clone(),
            SurfaceInfo {
                label: label.clone(),
                monitor: d.id.clone(),
                primary: d.primary,
                monitors: ids.clone(),
                displays: displays.clone(),
                width: d.width,
                height: d.height,
            },
        );
        // Registered before the window exists so its first `surface_info` call finds it.
        state.surfaces.lock().unwrap().insert(label.clone(), infos[&label].clone());
        match app.get_webview_window(&label) {
            Some(w) => place(app, &w, m)?,
            None => create(app, &label, m)?,
        }
    }
    *state.surfaces.lock().unwrap() = infos;
    let _ = app.emit("surface://info", ());
    crate::overlays::sync(app);
    Ok(())
}

/// Stable id of `m` (the `i`-th monitor): its device path, else its GDI name.
pub fn monitor_id(m: &Monitor, i: usize, identities: &HashMap<String, monitors::Identity>) -> String {
    let gdi = m.name().cloned();
    gdi.as_ref()
        .and_then(|g| identities.get(g))
        .map(|x| x.id.clone())
        .or(gdi)
        .unwrap_or_else(|| format!("monitor-{i}"))
}

fn create(app: &AppHandle, label: &str, m: &Monitor) -> tauri::Result<()> {
    let area = m.work_area();
    let scale = m.scale_factor();
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html?view=surface".into()))
        .title("PieDesk Surface")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        // Built visible on purpose: on a hidden window WebView2 creates its child HWNDs after
        // wry has installed its drop target, so its own target wins and Explorer drops are refused.
        .position(area.position.x as f64 / scale, area.position.y as f64 / scale)
        .inner_size(area.size.width as f64 / scale, area.size.height as f64 / scale)
        .always_on_bottom(true)
        .build()?;
    place(app, &win, m)?;
    desktop::pin(&win);
    let _ = win.set_ignore_cursor_events(true);
    let state = app.state::<AppState>();
    let hidden = state.user_hidden.load(Ordering::Relaxed);
    state.hit.update(label, |s| s.hidden = hidden);
    if !hidden {
        win.show()?;
    } else {
        win.hide()?;
    }
    Ok(())
}

fn place(app: &AppHandle, win: &WebviewWindow, m: &Monitor) -> tauri::Result<()> {
    let area = m.work_area();
    win.set_position(PhysicalPosition::new(area.position.x, area.position.y))?;
    win.set_size(PhysicalSize::new(area.size.width, area.size.height))?;
    let state = app.state::<AppState>();
    state.hit.update(win.label(), |s| {
        s.origin = (area.position.x as f64, area.position.y as f64);
        s.size = (area.size.width as f64, area.size.height as f64);
        s.scale = m.scale_factor();
    });
    state.hit.invalidate(win.label());
    Ok(())
}

/// Layouts from 0.1.4 and older are keyed by GDI name. Rewritten once, while that name most
/// likely still points at the same screen; names of monitors that are not connected stay and
/// show on the home monitor.
fn migrate_gdi_names(app: &AppHandle, monitors: &[Monitor], displays: &[Display]) {
    let state = app.state::<AppState>();
    if state.store.read(|d| d.setting_bool("stableMonitorIds", false)) {
        return;
    }
    let map: HashMap<String, String> = monitors
        .iter()
        .zip(displays)
        .filter_map(|(m, d)| m.name().filter(|n| *n != &d.id).map(|n| (n.clone(), d.id.clone())))
        .collect();
    let mut ops: Vec<Op> = state.store.read(|doc| {
        let mut ops = Vec::new();
        for (coll, items) in [(Coll::Boxes, &doc.boxes), (Coll::Widgets, &doc.widgets)] {
            for (id, value) in items {
                if let Some(new) = value.get("monitor").and_then(Value::as_str).and_then(|m| map.get(m)) {
                    let mut value = value.clone();
                    value["monitor"] = Value::String(new.clone());
                    ops.push(Op::Upsert { coll, id: id.clone(), value });
                }
            }
        }
        ops
    });
    ops.push(Op::Settings { value: serde_json::json!({ "stableMonitorIds": true }) });
    let rev = state.store.apply(&ops);
    let _ = app.emit("store://ops", OpsEvent { origin: "displays", rev, ops: &ops });
}

// ---------------------------------------------------------------------------------------------
// Watching for display changes

static WAKE: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

/// Something about the displays changed (called from the surfaces' window procedure, and when
/// the home monitor setting changes).
pub fn poke() {
    *WAKE.0.lock().unwrap() = true;
    WAKE.1.notify_one();
}

/// `WM_DISPLAYCHANGE` covers plugging and resolution changes; a slow poll catches the rest
/// (scale changes, taskbar moves on some builds).
pub fn start_watch(app: AppHandle) {
    let _ = std::thread::Builder::new().name("displays".into()).spawn(move || {
        let mut last = fingerprint(&app);
        loop {
            let poked = {
                let guard = WAKE.0.lock().unwrap();
                let (mut guard, _) = WAKE.1.wait_timeout_while(guard, Duration::from_secs(3), |p| !*p).unwrap();
                std::mem::take(&mut *guard)
            };
            if poked {
                // Windows sends a burst of messages while it rearranges the displays.
                std::thread::sleep(Duration::from_millis(400));
                *WAKE.0.lock().unwrap() = false;
            }
            let now = fingerprint(&app);
            if now != last {
                last = now;
                let _ = sync(&app);
            }
        }
    });
}

fn fingerprint(app: &AppHandle) -> String {
    let home = app.state::<AppState>().store.read(|d| d.setting_str("homeMonitor")).unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    let monitors = app.available_monitors().unwrap_or_default();
    let list: Vec<String> = monitors
        .iter()
        .map(|m| {
            let a = m.work_area();
            format!("{:?}@{},{} {}x{} {}", m.name(), a.position.x, a.position.y, a.size.width, a.size.height, m.scale_factor())
        })
        .collect();
    format!("{home}|{primary:?}|{}", list.join(";"))
}

// ---------------------------------------------------------------------------------------------
// Dragging a box or widget to another monitor

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragFrame {
    coll: String,
    id: String,
    title: String,
    w: f64,
    h: f64,
    /// Pointer offset inside the frame, CSS px.
    grab_x: f64,
    grab_y: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ghost {
    coll: String,
    id: String,
    title: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Debug, Serialize)]
pub struct Landing {
    monitor: String,
    x: f64,
    y: f64,
}

/// Surface currently drawing a ghost.
static GHOST: Mutex<Option<String>> = Mutex::new(None);

/// The other surface under the cursor and the frame's position on it.
fn landing(state: &AppState, from: &str, f: &DragFrame) -> Option<(String, Landing)> {
    let cursor = hittest::cursor_pos()?;
    let (label, s) = state.hit.find(|label, s| label != from && !s.hidden && s.covers(cursor))?;
    let monitor = state.surfaces.lock().unwrap().get(&label)?.monitor.clone();
    let (w, h) = (s.size.0 / s.scale, s.size.1 / s.scale);
    let x = ((cursor.0 - s.origin.0) / s.scale - f.grab_x).clamp(0.0, (w - f.w).max(0.0));
    let y = ((cursor.1 - s.origin.1) / s.scale - f.grab_y).clamp(0.0, (h - 32.0).max(0.0));
    Some((label, Landing { monitor, x: x.round(), y: y.round() }))
}

fn show_ghost(app: &AppHandle, target: Option<(&str, Ghost)>) {
    let mut cur = GHOST.lock().unwrap();
    let label = target.as_ref().map(|(l, _)| l.to_string());
    if *cur != label {
        if let Some(old) = cur.take() {
            let _ = app.emit_to(old.as_str(), "drag://ghost", None::<Ghost>);
        }
        *cur = label;
    }
    if let Some((label, ghost)) = target {
        let _ = app.emit_to(label, "drag://ghost", Some(ghost));
    }
}

/// Pointer is outside its surface mid-drag. Returns the monitor it would land on.
#[tauri::command]
pub fn drag_over(app: AppHandle, window: WebviewWindow, state: tauri::State<AppState>, frame: DragFrame) -> Option<String> {
    let hit = landing(&state, window.label(), &frame);
    let ghost = hit.as_ref().map(|(label, l)| {
        let g = Ghost { coll: frame.coll.clone(), id: frame.id.clone(), title: frame.title.clone(), x: l.x, y: l.y, w: frame.w, h: frame.h };
        (label.as_str(), g)
    });
    show_ghost(&app, ghost);
    hit.map(|(_, l)| l.monitor)
}

/// Drag released: clears the ghost and says where the frame lands, if on another monitor.
#[tauri::command]
pub fn drag_end(app: AppHandle, window: WebviewWindow, state: tauri::State<AppState>, frame: DragFrame) -> Option<Landing> {
    show_ghost(&app, None);
    landing(&state, window.label(), &frame).map(|(_, l)| l)
}

#[tauri::command]
pub fn list_displays(state: tauri::State<AppState>) -> Vec<Display> {
    let mut list = state.surfaces.lock().unwrap().values().next().map(|s| s.displays.clone()).unwrap_or_default();
    list.sort_by_key(|d| d.index);
    list
}
