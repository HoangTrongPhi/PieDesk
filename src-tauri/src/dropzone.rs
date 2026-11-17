//! Surface drop target: Explorer files *and* web links.
//!
//! wry's own drop target only accepts `CF_HDROP` (files), so a YouTube link dragged out of a
//! browser is refused before the page sees it. Each surface webview gets this target instead: it
//! reads files the same way and also takes a URL (`UniformResourceLocatorW`, `text/x-moz-url`,
//! or plain text that is a link). Events go to that surface as `drop://event`
//! `{ kind: "enter" | "over" | "drop" | "leave", paths, url, x, y }` (client pixels).

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct DropEvent {
    pub kind: &'static str,
    pub paths: Vec<String>,
    pub url: Option<String>,
    pub x: i32,
    pub y: i32,
}

/// First http(s) link in a dragged text (`text/x-moz-url` is "url\ntitle").
pub fn first_link(text: &str) -> Option<String> {
    text.split(['\r', '\n', '\0'])
        .map(str::trim)
        .find(|l| l.starts_with("https://") || l.starts_with("http://"))
        .filter(|l| !l.contains(char::is_whitespace) && l.len() < 4096)
        .map(str::to_owned)
}

#[cfg(windows)]
mod imp {
    use std::cell::{Cell, RefCell};

    use tauri::{Emitter, WebviewWindow};
    use windows::core::{implement, w, Ref, BOOL};
    use windows::Win32::Foundation::{HWND, LPARAM, POINT, POINTL};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
    use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::{
        IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop, CF_HDROP, CF_UNICODETEXT, DROPEFFECT,
        DROPEFFECT_COPY, DROPEFFECT_NONE,
    };
    use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

    use super::{first_link, DropEvent};

    #[implement(IDropTarget)]
    struct Target {
        hwnd: HWND,
        win: WebviewWindow,
        valid: Cell<bool>,
        paths: RefCell<Vec<String>>,
        url: RefCell<Option<String>>,
    }

    fn format(cf: u16) -> FORMATETC {
        FORMATETC { cfFormat: cf, ptd: std::ptr::null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 }
    }

    /// The bytes of an HGLOBAL format, if the data object has it.
    unsafe fn bytes(obj: &IDataObject, cf: u16) -> Option<Vec<u8>> {
        let mut medium = obj.GetData(&format(cf)).ok()?;
        let h = medium.u.hGlobal;
        let ptr = GlobalLock(h) as *const u8;
        let out = (!ptr.is_null()).then(|| std::slice::from_raw_parts(ptr, GlobalSize(h)).to_vec());
        let _ = GlobalUnlock(h);
        ReleaseStgMedium(&mut medium);
        out
    }

    fn utf16(b: &[u8]) -> String {
        let w: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&c| c != 0).collect();
        String::from_utf16_lossy(&w)
    }

    unsafe fn paths(obj: &IDataObject) -> Vec<String> {
        let Ok(mut medium) = obj.GetData(&format(CF_HDROP.0)) else { return Vec::new() };
        let hdrop = HDROP(medium.u.hGlobal.0 as _);
        let n = DragQueryFileW(hdrop, u32::MAX, None);
        let mut out = Vec::with_capacity(n as usize);
        for i in 0..n {
            let len = DragQueryFileW(hdrop, i, None) as usize;
            let mut buf = vec![0u16; len + 1];
            DragQueryFileW(hdrop, i, Some(&mut buf));
            out.push(String::from_utf16_lossy(&buf[..len]));
        }
        ReleaseStgMedium(&mut medium);
        out
    }

    unsafe fn link(obj: &IDataObject) -> Option<String> {
        let url_w = RegisterClipboardFormatW(w!("UniformResourceLocatorW")) as u16;
        let moz = RegisterClipboardFormatW(w!("text/x-moz-url")) as u16;
        for cf in [url_w, moz, CF_UNICODETEXT.0] {
            if let Some(found) = bytes(obj, cf).and_then(|b| first_link(&utf16(&b))) {
                return Some(found);
            }
        }
        None
    }

    impl Target {
        fn client(&self, pt: &POINTL) -> (i32, i32) {
            let mut p = POINT { x: pt.x, y: pt.y };
            let _ = unsafe { ScreenToClient(self.hwnd, &mut p) };
            (p.x, p.y)
        }

        fn send(&self, kind: &'static str, pt: Option<&POINTL>) {
            let (x, y) = pt.map(|p| self.client(p)).unwrap_or_default();
            let ev = DropEvent { kind, paths: self.paths.borrow().clone(), url: self.url.borrow().clone(), x, y };
            let _ = self.win.emit_to(self.win.label(), "drop://event", ev);
        }
    }

    impl IDropTarget_Impl for Target_Impl {
        fn DragEnter(&self, data: Ref<'_, IDataObject>, _keys: MODIFIERKEYS_FLAGS, pt: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
            let (p, u) = match data.as_ref() {
                Some(obj) => unsafe {
                    let p = paths(obj);
                    let u = if p.is_empty() { link(obj) } else { None };
                    (p, u)
                },
                None => (Vec::new(), None),
            };
            let valid = !p.is_empty() || u.is_some();
            self.valid.set(valid);
            *self.paths.borrow_mut() = p;
            *self.url.borrow_mut() = u;
            unsafe { *effect = if valid { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
            if valid {
                self.send("enter", Some(pt));
            }
            Ok(())
        }

        fn DragOver(&self, _keys: MODIFIERKEYS_FLAGS, pt: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
            let valid = self.valid.get();
            unsafe { *effect = if valid { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
            if valid {
                self.send("over", Some(pt));
            }
            Ok(())
        }

        fn DragLeave(&self) -> windows::core::Result<()> {
            if self.valid.replace(false) {
                self.send("leave", None);
            }
            Ok(())
        }

        fn Drop(&self, _data: Ref<'_, IDataObject>, _keys: MODIFIERKEYS_FLAGS, pt: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
            if self.valid.replace(false) {
                unsafe { *effect = DROPEFFECT_COPY };
                self.send("drop", Some(pt));
            } else {
                unsafe { *effect = DROPEFFECT_NONE };
            }
            Ok(())
        }
    }

    /// Replaces the drop target of the webview's child windows. Must run on the UI thread.
    pub fn install(win: &WebviewWindow) {
        let Ok(top) = win.hwnd() else { return };
        let mut children: Vec<HWND> = Vec::new();
        unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let list = &mut *(lparam.0 as *mut Vec<HWND>);
            list.push(hwnd);
            true.into()
        }
        unsafe {
            let _ = EnumChildWindows(Some(top), Some(collect), LPARAM(&mut children as *mut _ as isize));
        }
        for hwnd in children {
            let target: IDropTarget = Target {
                hwnd,
                win: win.clone(),
                valid: Cell::new(false),
                paths: RefCell::new(Vec::new()),
                url: RefCell::new(None),
            }
            .into();
            unsafe {
                // Only where a target was registered before (the WebView2 windows).
                if RevokeDragDrop(hwnd).is_ok() {
                    let _ = RegisterDragDrop(hwnd, &target);
                }
            }
        }
    }
}

/// Installs the surface drop target now and once more shortly after, in case WebView2 created
/// its windows late.
pub fn attach(win: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        imp::install(win);
        let w = win.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let inner = w.clone();
            let _ = w.run_on_main_thread(move || imp::install(&inner));
        });
    }
    #[cfg(not(windows))]
    let _ = win;
}

#[cfg(test)]
mod tests {
    use super::first_link;

    #[test]
    fn finds_links() {
        assert_eq!(first_link("https://youtu.be/abc\nA title").as_deref(), Some("https://youtu.be/abc"));
        assert_eq!(first_link("hello world").as_deref(), None);
        assert_eq!(first_link("  https://www.youtube.com/watch?v=x  ").as_deref(), Some("https://www.youtube.com/watch?v=x"));
    }
}
