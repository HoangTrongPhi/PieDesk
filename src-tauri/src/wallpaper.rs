//! Theme wallpapers: while a holiday theme with its own picture is on (setting `themeWallpaper`),
//! every monitor shows `wallpapers/<theme>.jpg` (bundled resource); afterwards each monitor gets
//! its own wallpaper back. What to put back is kept in `wallpaper.json` so it survives restarts.
//! A monitor whose wallpaper the user changed meanwhile is left alone. A running Windows slideshow
//! is paused for the holiday and started again (same pictures, interval and shuffle) afterwards.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::AppState;

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    /// Theme whose picture is on.
    theme: String,
    /// The picture we set.
    path: String,
    /// The user changed it while the theme was on: leave everything as they set it.
    #[serde(default)]
    overridden: bool,
    /// Picture fit before ours (DESKTOP_WALLPAPER_POSITION).
    position: i32,
    /// Monitor device path → the user's own picture.
    monitors: Vec<(String, String)>,
    /// The user's slideshow, if one was running.
    #[serde(default)]
    slideshow: Option<Slideshow>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Slideshow {
    /// Folders or pictures it cycles through.
    items: Vec<String>,
    options: i32,
    tick: u32,
}

/// Serialises applies and restores (they come from a thread per call).
static BUSY: Mutex<()> = Mutex::new(());

fn saved_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("wallpaper.json"))
}

fn load(file: &Path) -> Option<Saved> {
    serde_json::from_slice(&std::fs::read(file).ok()?).ok()
}

fn log(app: &AppHandle, line: &str) {
    app.state::<AppState>().store.log(&format!("wallpaper: {line}"));
}

/// Shows the wallpaper of `theme`, or (None) puts the user's own back. Off the calling thread.
pub fn set_later(app: &AppHandle, theme: Option<String>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _busy = BUSY.lock().unwrap();
        let Some(file) = saved_path(&app) else { return };
        let picture = theme.as_deref().and_then(|t| app.path().resolve(format!("wallpapers/{t}.jpg"), BaseDirectory::Resource).ok()).filter(|p| p.is_file());
        let result = match (theme, picture) {
            (Some(theme), Some(picture)) => apply(&file, &theme, &picture),
            _ => restore(&file),
        };
        if let Err(e) = result {
            log(&app, &e);
        }
    });
}

/// Puts the user's wallpapers back now (quitting PieDesk).
pub fn restore_now(app: &AppHandle) {
    let _busy = BUSY.lock().unwrap();
    if let Some(file) = saved_path(app) {
        if let Err(e) = restore(&file) {
            log(app, &e);
        }
    }
}

fn same(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

fn apply(file: &Path, theme: &str, picture: &Path) -> Result<(), String> {
    let picture = picture.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    let dw = sys::Desktop::new()?;
    let before = std::fs::read(file).ok();
    let mut saved = load(file);
    if let Some(s) = saved.as_mut().filter(|s| s.theme == theme) {
        // Already on. If the user has put their own picture over it since, leave it that way.
        if !s.overridden && dw.monitors()?.iter().any(|(_, w)| !same(w, &s.path)) {
            s.overridden = true;
            let _ = std::fs::write(file, serde_json::to_vec(&*s).unwrap_or_default());
        }
        return Ok(());
    }
    // The user's own pictures are remembered once: going from one theme to another keeps them.
    let mut s = match saved {
        Some(s) => s,
        None => {
            let slideshow = if dw.slideshow_running() { dw.slideshow() } else { None };
            Saved { position: dw.position(), monitors: dw.monitors().unwrap_or_default(), slideshow, ..Default::default() }
        }
    };
    s.theme = theme.to_string();
    s.path = picture.clone();
    s.overridden = false;
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(file, serde_json::to_vec(&s).map_err(|e| e.to_string())?).map_err(|e| format!("save: {e}"))?;
    dw.set_all(&picture, sys::FILL).inspect_err(|_| {
        // Nothing changed on screen: the file must say so too.
        let _ = match &before {
            Some(b) => std::fs::write(file, b),
            None => std::fs::remove_file(file),
        };
    })
}

fn restore(file: &Path) -> Result<(), String> {
    let Some(s) = load(file) else { return Ok(()) };
    let dw = sys::Desktop::new()?;
    let now = dw.monitors()?;
    let mut all = true;
    if let Some(show) = &s.slideshow {
        // The slideshow comes back unless the user picked something else meanwhile.
        if now.iter().all(|(_, w)| same(w, &s.path)) {
            dw.set_slideshow(show)?;
            return std::fs::remove_file(file).map_err(|e| format!("forget: {e}"));
        }
    }
    for (monitor, own) in &s.monitors {
        // Only where our picture is still showing: a picture the user chose since stays.
        if now.iter().any(|(m, w)| m == monitor && same(w, &s.path)) {
            dw.set(monitor, own)?;
        } else {
            all = false;
        }
    }
    if all {
        dw.set_position(s.position);
    }
    std::fs::remove_file(file).map_err(|e| format!("forget: {e}"))
}

#[cfg(windows)]
mod sys {
    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, IBindCtx, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        DesktopWallpaper, IDesktopWallpaper, ILFree, SHCreateShellItemArrayFromIDLists, SHParseDisplayName, DESKTOP_SLIDESHOW_OPTIONS,
        DESKTOP_WALLPAPER_POSITION, DSS_ENABLED, DSS_SLIDESHOW, SIGDN_FILESYSPATH,
    };

    use super::Slideshow;

    pub const FILL: i32 = windows::Win32::UI::Shell::DWPOS_FILL.0;

    pub struct Desktop(IDesktopWallpaper);

    fn take(p: PWSTR) -> String {
        let s = unsafe { p.to_string() }.unwrap_or_default();
        unsafe { CoTaskMemFree(Some(p.0 as _)) };
        s
    }

    impl Desktop {
        pub fn new() -> Result<Self, String> {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                CoCreateInstance::<_, IDesktopWallpaper>(&DesktopWallpaper, None, CLSCTX_ALL).map(Desktop).map_err(|e| format!("IDesktopWallpaper: {e}"))
            }
        }
        /// (monitor device path, its wallpaper file) for every monitor.
        pub fn monitors(&self) -> Result<Vec<(String, String)>, String> {
            unsafe {
                let n = self.0.GetMonitorDevicePathCount().map_err(|e| e.to_string())?;
                let mut out = Vec::new();
                for i in 0..n {
                    let Ok(id) = self.0.GetMonitorDevicePathAt(i) else { continue };
                    let id = take(id);
                    let wall = self.0.GetWallpaper(&HSTRING::from(&id)).map(take).unwrap_or_default();
                    out.push((id, wall));
                }
                Ok(out)
            }
        }
        pub fn slideshow_running(&self) -> bool {
            unsafe { self.0.GetStatus() }.is_ok_and(|s| s.0 & DSS_ENABLED.0 != 0 && s.0 & DSS_SLIDESHOW.0 != 0)
        }
        /// What the running slideshow shows, and how.
        pub fn slideshow(&self) -> Option<Slideshow> {
            unsafe {
                let arr = self.0.GetSlideshow().ok()?;
                let mut items = Vec::new();
                for i in 0..arr.GetCount().ok()? {
                    if let Ok(path) = arr.GetItemAt(i).and_then(|it| it.GetDisplayName(SIGDN_FILESYSPATH)) {
                        items.push(take(path));
                    }
                }
                let (mut options, mut tick) = (DESKTOP_SLIDESHOW_OPTIONS(0), 0u32);
                let _ = self.0.GetSlideshowOptions(&mut options, &mut tick);
                (!items.is_empty()).then_some(Slideshow { items, options: options.0, tick })
            }
        }
        pub fn set_slideshow(&self, s: &Slideshow) -> Result<(), String> {
            unsafe {
                let mut pidls: Vec<*const ITEMIDLIST> = Vec::new();
                for item in &s.items {
                    let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
                    if SHParseDisplayName(&HSTRING::from(item), None::<&IBindCtx>, &mut pidl, 0, None).is_ok() {
                        pidls.push(pidl);
                    }
                }
                let result = SHCreateShellItemArrayFromIDLists(&pidls)
                    .and_then(|arr| self.0.SetSlideshow(&arr))
                    .and_then(|_| self.0.SetSlideshowOptions(DESKTOP_SLIDESHOW_OPTIONS(s.options), s.tick))
                    .map_err(|e| format!("slideshow: {e}"));
                for p in pidls {
                    ILFree(Some(p));
                }
                result
            }
        }
        pub fn position(&self) -> i32 {
            unsafe { self.0.GetPosition() }.map_or(FILL, |p| p.0)
        }
        pub fn set_position(&self, p: i32) {
            let _ = unsafe { self.0.SetPosition(DESKTOP_WALLPAPER_POSITION(p)) };
        }
        pub fn set(&self, monitor: &str, picture: &str) -> Result<(), String> {
            unsafe { self.0.SetWallpaper(&HSTRING::from(monitor), &HSTRING::from(picture)) }.map_err(|e| format!("set {monitor}: {e}"))
        }
        /// The same picture on every monitor, with the given fit.
        pub fn set_all(&self, picture: &str, position: i32) -> Result<(), String> {
            unsafe {
                self.0.SetWallpaper(PCWSTR::null(), &HSTRING::from(picture)).map_err(|e| format!("set: {e}"))?;
            }
            self.set_position(position);
            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod sys {
    pub const FILL: i32 = 4;
    pub struct Desktop;
    impl Desktop {
        pub fn new() -> Result<Self, String> {
            Err("not supported".into())
        }
        pub fn monitors(&self) -> Result<Vec<(String, String)>, String> {
            Ok(Vec::new())
        }
        pub fn slideshow_running(&self) -> bool {
            false
        }
        pub fn slideshow(&self) -> Option<super::Slideshow> {
            None
        }
        pub fn set_slideshow(&self, _: &super::Slideshow) -> Result<(), String> {
            Ok(())
        }
        pub fn position(&self) -> i32 {
            FILL
        }
        pub fn set_position(&self, _: i32) {}
        pub fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Ok(())
        }
        pub fn set_all(&self, _: &str, _: i32) -> Result<(), String> {
            Ok(())
        }
    }
}
