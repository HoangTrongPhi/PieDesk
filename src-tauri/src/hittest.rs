//! Click-through for the transparent surfaces.
//!
//! Each surface covers a whole monitor, but only its boxes and widgets should take the mouse.
//! The frontend reports its interactive rects (CSS px) whenever the layout changes; a light
//! thread compares the cursor against them and flips `set_ignore_cursor_events` only when the
//! state changes. The WebView itself is never woken up by this loop.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};

const TICK: Duration = Duration::from_millis(16);

#[derive(Debug, Clone, Default)]
pub struct Surface {
    /// Physical screen position of the window's client area.
    pub origin: (f64, f64),
    pub scale: f64,
    /// `[x, y, w, h]` in CSS px, relative to the window.
    pub rects: Vec<[f64; 4]>,
    /// The whole surface takes the mouse (dragging, open menu, dialog).
    pub capture: bool,
    pub hidden: bool,
    interactive: Option<bool>,
}

impl Surface {
    pub fn contains(&self, cursor: (f64, f64)) -> bool {
        if self.capture {
            return true;
        }
        let x = (cursor.0 - self.origin.0) / self.scale;
        let y = (cursor.1 - self.origin.1) / self.scale;
        self.rects.iter().any(|r| x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3])
    }
}

#[derive(Clone, Default)]
pub struct HitTest(pub Arc<Mutex<HashMap<String, Surface>>>);

impl HitTest {
    pub fn update(&self, label: &str, f: impl FnOnce(&mut Surface)) {
        let mut map = self.0.lock().unwrap();
        f(map.entry(label.to_owned()).or_default());
    }

    pub fn start(&self, app: AppHandle) {
        let this = self.clone();
        std::thread::Builder::new()
            .name("hittest".into())
            .spawn(move || {
                let mut last_cursor = (f64::NAN, f64::NAN);
                loop {
                    std::thread::sleep(TICK);
                    let Some(cursor) = cursor_pos() else { continue };
                    let moved = cursor != last_cursor;
                    last_cursor = cursor;
                    let mut changes = Vec::new();
                    {
                        let mut map = this.0.lock().unwrap();
                        for (label, s) in map.iter_mut() {
                            if s.hidden {
                                continue;
                            }
                            // Re-evaluate on movement, or when rects/capture changed (interactive reset to None).
                            if !moved && s.interactive.is_some() {
                                continue;
                            }
                            let inside = s.contains(cursor);
                            if s.interactive != Some(inside) {
                                s.interactive = Some(inside);
                                changes.push((label.clone(), inside));
                            }
                        }
                    }
                    // Outside the lock: window calls hop to the main thread.
                    for (label, inside) in changes {
                        if let Some(w) = app.get_webview_window(&label) {
                            let _ = w.set_ignore_cursor_events(!inside);
                        }
                    }
                }
            })
            .ok();
    }

    /// Forces a re-check on the next tick (call after rects or capture change).
    pub fn invalidate(&self, label: &str) {
        if let Some(s) = self.0.lock().unwrap().get_mut(label) {
            s.interactive = None;
        }
    }
}

#[cfg(windows)]
fn cursor_pos() -> Option<(f64, f64)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

#[cfg(not(windows))]
fn cursor_pos() -> Option<(f64, f64)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contains_scales_and_offsets() {
        let s = Surface {
            origin: (1920.0, 0.0),
            scale: 1.5,
            rects: vec![[100.0, 100.0, 200.0, 100.0]],
            ..Default::default()
        };
        // CSS (150, 150) on a monitor at x=1920 with 150 % scale.
        assert!(s.contains((1920.0 + 225.0, 225.0)));
        assert!(!s.contains((1920.0 + 50.0, 225.0)));
        assert!(!s.contains((225.0, 225.0)));
        let captured = Surface { capture: true, ..s };
        assert!(captured.contains((0.0, 0.0)));
    }
}
