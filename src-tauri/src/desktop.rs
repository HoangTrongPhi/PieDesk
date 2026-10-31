//! Pins a surface window to the desktop layer.
//!
//! - Owner = Progman: owned windows of the desktop survive Win+D / "Show desktop".
//! - WS_EX_TOOLWINDOW: no taskbar button, no Alt+Tab entry.
//! - A subclass forces HWND_BOTTOM on every z-order change, so clicking a box never lifts the
//!   full-screen surface above other apps. It also reports display changes (`surfaces::poke`).

use tauri::WebviewWindow;

#[cfg(windows)]
mod imp {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWLP_HWNDPARENT, GWL_EXSTYLE, HWND_BOTTOM,
        SPI_SETWORKAREA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WINDOWPOS, WM_DISPLAYCHANGE, WM_SETTINGCHANGE,
        WM_WINDOWPOSCHANGING, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    const SUBCLASS_ID: usize = 0x5049_4544; // "PIED"

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == WM_WINDOWPOSCHANGING {
            let pos = lparam.0 as *mut WINDOWPOS;
            if !pos.is_null() {
                (*pos).hwndInsertAfter = HWND_BOTTOM;
                (*pos).flags &= !SWP_NOZORDER;
            }
        }
        if msg == WM_DISPLAYCHANGE || (msg == WM_SETTINGCHANGE && wparam.0 == SPI_SETWORKAREA.0 as usize) {
            crate::surfaces::poke();
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    pub fn float(raw: isize) {
        let hwnd = HWND(raw as _);
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let ex = (ex | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TRANSPARENT.0) as isize) & !(WS_EX_APPWINDOW.0 as isize);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
        }
    }

    pub fn pin(raw: isize) {
        let hwnd = HWND(raw as _);
        unsafe {
            if let Ok(progman) = FindWindowW(w!("Progman"), None) {
                SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, progman.0 as isize);
            }
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let ex = (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
            let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
            let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
}

/// Overlay windows: no taskbar button or Alt+Tab entry, and clicking through never activates them.
pub fn float(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        imp::float(hwnd.0 as isize);
    }
    #[cfg(not(windows))]
    let _ = window;
}

pub fn pin(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        imp::pin(hwnd.0 as isize);
    }
    #[cfg(not(windows))]
    let _ = window;
}
