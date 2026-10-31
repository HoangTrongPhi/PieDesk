//! Fullscreen guard: while a game, video or presentation is fullscreen, hide the surfaces and
//! pause the data hub so PieDesk costs ~0 % CPU. Also reports running on battery, which pauses
//! effects (setting `fxBattery`).

use std::sync::atomic::{AtomicBool, Ordering};
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
        Ok(state) if state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE => true,
        // Windows also says "busy" for our own overlay windows (topmost, covering the monitor):
        // trusting that would hide them, end the "busy", show them again… a blink every poll.
        Ok(state) if state == QUNS_BUSY => foreground_fullscreen(),
        _ => false,
    }
}

/// The focused window belongs to another app and covers its whole monitor.
#[cfg(windows)]
fn foreground_fullscreen() -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId};
    unsafe {
        let h = GetForegroundWindow();
        if h.is_invalid() {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(h, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return false;
        }
        // The desktop and the taskbar are as big as the monitor too.
        let mut class = [0u16; 64];
        let n = GetClassNameW(h, &mut class) as usize;
        if matches!(String::from_utf16_lossy(&class[..n]).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return false;
        }
        let mut r = RECT::default();
        let mut mi = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetWindowRect(h, &mut r).is_err() || !GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mut mi).as_bool() {
            return false;
        }
        let m = mi.rcMonitor;
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}

#[cfg(not(windows))]
fn fullscreen_busy() -> bool {
    false
}

static ON_BATTERY: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
fn on_battery() -> bool {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s = SYSTEM_POWER_STATUS::default();
    // ACLineStatus: 0 = on battery, 1 = plugged in, 255 = unknown (desktops).
    unsafe { GetSystemPowerStatus(&mut s).is_ok() && s.ACLineStatus == 0 }
}

#[cfg(not(windows))]
fn on_battery() -> bool {
    false
}

#[tauri::command]
pub fn power_on_battery() -> bool {
    ON_BATTERY.load(Ordering::Relaxed)
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("guard".into())
        .spawn(move || {
            let mut paused = false;
            ON_BATTERY.store(on_battery(), Ordering::Relaxed);
            loop {
                std::thread::sleep(POLL);
                let battery = on_battery();
                if ON_BATTERY.swap(battery, Ordering::Relaxed) != battery {
                    let _ = app.emit("power://battery", battery);
                }
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
