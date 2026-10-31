//! Overlay windows: one transparent, click-through, always-on-top window per monitor for effects
//! that float above every app (setting `overlayFx`) and for Pie the cat "on top" (`pet`).
//! They exist only while one of those is on, never take focus or the mouse, and hide with the
//! surfaces (fullscreen guard, show / hide desktop).

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::{desktop, monitors, surfaces, AppState};

pub const PREFIX: &str = "overlay-";

static NEXT: AtomicUsize = AtomicUsize::new(0);
/// Monitor id → overlay window label. Also serialises `sync`.
static OPEN: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn wanted(app: &AppHandle) -> bool {
    app.state::<AppState>().store.read(|d| {
        d.setting_str("overlayFx").is_some_and(|v| v != "off") || d.setting_str("pet").as_deref() == Some("top")
    })
}

/// Opens, moves or closes overlay windows to match the settings and the connected monitors.
/// Builds windows, so call it off the main thread (or from setup).
pub fn sync(app: &AppHandle) {
    let mut guard = OPEN.lock().unwrap();
    let open = guard.get_or_insert_with(HashMap::new);
    let monitors = app.available_monitors().unwrap_or_default();
    let identities = monitors::identities();
    let ids: Vec<String> = monitors.iter().enumerate().map(|(i, m)| surfaces::monitor_id(m, i, &identities)).collect();
    let want = wanted(app);

    open.retain(|id, label| {
        let keep = want && ids.contains(id);
        if !keep {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.destroy();
            }
        }
        keep
    });
    if !want {
        return;
    }
    let state = app.state::<AppState>();
    let hidden = state.user_hidden.load(Ordering::Relaxed) || state.hub.paused.load(Ordering::Relaxed);
    for (id, m) in ids.iter().zip(&monitors) {
        match open.get(id).and_then(|l| app.get_webview_window(l)) {
            Some(w) => {
                let _ = w.set_position(m.position().to_owned());
                let _ = w.set_size(m.size().to_owned());
            }
            None => {
                let label = format!("{PREFIX}{}", NEXT.fetch_add(1, Ordering::Relaxed));
                if create(app, &label, m, hidden).is_ok() {
                    open.insert(id.clone(), label);
                }
            }
        }
    }
}

fn create(app: &AppHandle, label: &str, m: &Monitor, hidden: bool) -> tauri::Result<()> {
    let scale = m.scale_factor();
    let (pos, size, work) = (m.position(), m.size(), m.work_area());
    // Where the taskbar starts, in CSS px from the top of the monitor: Pie walks on it.
    let floor = ((work.position.y + work.size.height as i32 - pos.y) as f64 / scale).round();
    let url = format!("index.html?view=overlay&floor={floor}");
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title("PieDesk Overlay")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .always_on_top(true)
        .position(pos.x as f64 / scale, pos.y as f64 / scale)
        .inner_size(size.width as f64 / scale, size.height as f64 / scale)
        .build()?;
    win.set_position(PhysicalPosition::new(pos.x, pos.y))?;
    win.set_size(PhysicalSize::new(size.width, size.height))?;
    win.set_ignore_cursor_events(true)?;
    desktop::float(&win);
    if hidden {
        win.hide()?;
    }
    Ok(())
}

/// Called after a setting that affects overlays changed (from a command on the main thread).
pub fn sync_later(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || sync(&app));
}
