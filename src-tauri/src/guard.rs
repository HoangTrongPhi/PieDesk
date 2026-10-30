//! Fullscreen guard: while a game, video or presentation is fullscreen, hide the surfaces and
//! pause the data hub so PieDesk costs ~0 % CPU.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::{AppState, SURFACE_PREFIX};

const POLL: Duration = Duration::from_secs(2);

#[cfg(windows)]
fn fullscreen_busy() -> bool {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE,
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn fullscreen_busy() -> bool {
    false
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("guard".into())
        .spawn(move || {
            let mut paused = false;
            loop {
                std::thread::sleep(POLL);
                let state = app.state::<AppState>();
                let enabled = state.store.read(|d| d.setting_bool("pauseOnFullscreen", true));
                let busy = enabled && fullscreen_busy();
                // The user's own hide toggle wins over the guard.
                let user_hidden = state.user_hidden.load(Ordering::Relaxed);
                if busy == paused {
                    continue;
                }
                paused = busy;
                state.hub.paused.store(busy, Ordering::Relaxed);
                if !user_hidden {
                    crate::set_surfaces_visible(&app, !busy);
                }
                let _ = app.emit("guard://paused", busy);
                for (label, _) in app.webview_windows().into_iter().filter(|(l, _)| l.starts_with(SURFACE_PREFIX)) {
                    state.hit.update(&label, |s| s.hidden = busy || user_hidden);
                }
            }
        })
        .ok();
}
