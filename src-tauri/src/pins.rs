//! Floating ("always on top") widgets, PureRef style: a media frame whose `config.onTop` is not
//! `false` (the default) lives in its own borderless window above every app instead of on the
//! desktop surface.
//!
//! The widget keeps its usual model (monitor id + CSS px inside that monitor's work area), so
//! turning the option off puts it back on the desktop exactly where the window was. `sync` opens,
//! moves or closes the windows to match the document; when the user moves or resizes one, its
//! page calls `pin_commit`, which writes the new place back (as an ordinary store op).

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::store::{Coll, Op};
use crate::{monitors, surfaces, AppState, OpsEvent};

pub const PREFIX: &str = "pin-";

/// Serialises `sync` (it runs on helper threads).
static SYNC: Mutex<()> = Mutex::new(());

/// Widget types that can float. Only the media frame for now.
fn floats(widget: &Value) -> bool {
    widget.get("type").and_then(Value::as_str) == Some("photo")
        && widget.get("config").and_then(|c| c.get("onTop")).and_then(Value::as_bool) != Some(false)
}

struct Place {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

/// Where a widget's window goes on screen, in physical pixels. A widget of a monitor that is not
/// connected shows on the home monitor (like the surfaces do).
fn place(widget: &Value, monitors: &[(String, Monitor)], home: usize) -> Option<Place> {
    let id = widget.get("monitor").and_then(Value::as_str).unwrap_or("");
    let (_, m) = monitors.iter().find(|(mid, _)| mid == id).or_else(|| monitors.get(home))?;
    let n = |k: &str, d: f64| widget.get(k).and_then(Value::as_f64).unwrap_or(d);
    let (scale, area) = (m.scale_factor(), m.work_area());
    let (w, h) = ((n("w", 320.0) * scale).round().max(80.0), (n("h", 200.0) * scale).round().max(60.0));
    // Kept reachable: at least part of the window stays inside the work area.
    let max_x = area.size.width as f64 - 60.0 * scale;
    let max_y = area.size.height as f64 - 40.0 * scale;
    let x = (n("x", 0.0) * scale).round().clamp(0.0, max_x.max(0.0));
    let y = (n("y", 0.0) * scale).round().clamp(0.0, max_y.max(0.0));
    Some(Place { x: area.position.x + x as i32, y: area.position.y + y as i32, w: w as u32, h: h as u32 })
}

fn connected(app: &AppHandle) -> (Vec<(String, Monitor)>, usize) {
    let list = app.available_monitors().unwrap_or_default();
    let identities = monitors::identities();
    let monitors: Vec<(String, Monitor)> =
        list.into_iter().enumerate().map(|(i, m)| (surfaces::monitor_id(&m, i, &identities), m)).collect();
    // The home surface knows which monitor is home.
    let state = app.state::<AppState>();
    let home_id = state.surfaces.lock().unwrap().values().find(|s| s.primary).map(|s| s.monitor.clone());
    let home = home_id.and_then(|h| monitors.iter().position(|(id, _)| *id == h)).unwrap_or(0);
    (monitors, home)
}

/// Opens, moves or closes the floating windows to match the document.
pub fn sync(app: &AppHandle) {
    let _guard = SYNC.lock().unwrap_or_else(|e| e.into_inner());
    let state = app.state::<AppState>();
    let wanted: HashMap<String, Value> = state
        .store
        .read(|d| d.widgets.iter().filter(|(_, w)| floats(w)).map(|(id, w)| (format!("{PREFIX}{id}"), w.clone())).collect());

    for (label, w) in app.webview_windows() {
        if label.starts_with(PREFIX) && !wanted.contains_key(&label) {
            let _ = w.destroy();
        }
    }
    if wanted.is_empty() {
        return;
    }
    let (monitors, home) = connected(app);
    let hidden = state.user_hidden.load(Ordering::Relaxed);
    for (label, widget) in &wanted {
        let Some(p) = place(widget, &monitors, home) else { continue };
        match app.get_webview_window(label) {
            Some(win) => {
                // Only when it really moved: the window itself is usually where the change came from.
                let pos = win.outer_position().ok();
                let size = win.inner_size().ok();
                if pos.is_none_or(|q| (q.x - p.x).abs() > 2 || (q.y - p.y).abs() > 2) {
                    let _ = win.set_position(PhysicalPosition::new(p.x, p.y));
                }
                if size.is_none_or(|s| s.width.abs_diff(p.w) > 2 || s.height.abs_diff(p.h) > 2) {
                    let _ = win.set_size(PhysicalSize::new(p.w, p.h));
                }
            }
            None => {
                if let Err(e) = create(app, label, &p, hidden) {
                    state.store.log(&format!("pin {label}: {e}"));
                }
            }
        }
    }
}

fn create(app: &AppHandle, label: &str, p: &Place, hidden: bool) -> tauri::Result<()> {
    let id = &label[PREFIX.len()..];
    let url = format!("index.html?view=pin&id={id}");
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title("PieDesk")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(true)
        .focused(false)
        .always_on_top(true)
        .visible(false)
        .min_inner_size(120.0, 80.0)
        .build()?;
    win.set_position(PhysicalPosition::new(p.x, p.y))?;
    win.set_size(PhysicalSize::new(p.w, p.h))?;
    // Files from Explorer and links from a browser, like on the desktop.
    crate::dropzone::attach(&win);
    if !hidden {
        win.show()?;
    }
    Ok(())
}

/// Runs `sync` off the calling thread (building windows waits on the main thread).
pub fn sync_later(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || sync(&app));
}

/// Shows or hides every floating window (the user's show / hide desktop toggle).
pub fn set_visible(app: &AppHandle, visible: bool) {
    for (label, w) in app.webview_windows() {
        if label.starts_with(PREFIX) {
            let _ = if visible { w.show() } else { w.hide() };
        }
    }
}

/// The ops touch a widget that floats or used to: the windows need another look.
pub fn affected(app: &AppHandle, ops: &[Op]) -> bool {
    ops.iter().any(|op| match op {
        Op::Upsert { coll: Coll::Widgets, id, value } => floats(value) || app.get_webview_window(&format!("{PREFIX}{id}")).is_some(),
        Op::Delete { coll: Coll::Widgets, id } => app.get_webview_window(&format!("{PREFIX}{id}")).is_some(),
        _ => false,
    })
}

/// The user moved or resized a floating window: store its new place (monitor under its centre).
#[tauri::command]
pub fn pin_commit(app: AppHandle, window: WebviewWindow, state: tauri::State<AppState>) -> Result<(), String> {
    let Some(id) = window.label().strip_prefix(PREFIX).map(str::to_string) else { return Err("not a floating window".into()) };
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let (cx, cy) = (pos.x + size.width as i32 / 2, pos.y + size.height as i32 / 2);
    let (monitors, home) = connected(&app);
    let (mid, m) = monitors
        .iter()
        .find(|(_, m)| {
            let (p, s) = (m.position(), m.size());
            cx >= p.x && cy >= p.y && cx < p.x + s.width as i32 && cy < p.y + s.height as i32
        })
        .or_else(|| monitors.get(home))
        .ok_or("no monitor")?;
    let (scale, area) = (m.scale_factor(), m.work_area());
    let Some(mut value) = state.store.read(|d| d.widgets.get(&id).cloned()) else { return Err("gone".into()) };
    let round = |v: f64| (v * 10.0).round() / 10.0;
    value["monitor"] = Value::String(mid.clone());
    value["x"] = round((pos.x - area.position.x) as f64 / scale).into();
    value["y"] = round((pos.y - area.position.y) as f64 / scale).into();
    value["w"] = round(size.width as f64 / scale).into();
    value["h"] = round(size.height as f64 / scale).into();
    let ops = vec![Op::Upsert { coll: Coll::Widgets, id, value }];
    let rev = state.store.apply(&ops);
    let _ = app.emit("store://ops", OpsEvent { origin: window.label(), rev, ops: &ops });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_frames_float_unless_turned_off() {
        assert!(floats(&serde_json::json!({ "type": "photo", "config": {} })));
        assert!(floats(&serde_json::json!({ "type": "photo", "config": { "onTop": true } })));
        assert!(!floats(&serde_json::json!({ "type": "photo", "config": { "onTop": false } })));
        assert!(!floats(&serde_json::json!({ "type": "clock", "config": {} })));
    }
}
