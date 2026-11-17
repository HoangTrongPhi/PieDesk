//! Launching items through the Windows shell (handles .lnk, .url, folders, documents).

use std::process::Command;

#[cfg(windows)]
pub fn open(path: &str, admin: bool) -> Result<(), String> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file = HSTRING::from(path);
    let verb = if admin { w!("runas") } else { PCWSTR::null() };
    let dir = std::path::Path::new(path).parent().map(|p| HSTRING::from(p.as_os_str()));
    let dir_ptr = dir.as_ref().map_or(PCWSTR::null(), |d| PCWSTR(d.as_ptr()));
    let result = unsafe { ShellExecuteW(None, verb, &file, PCWSTR::null(), dir_ptr, SW_SHOWNORMAL) };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("Không mở được \"{path}\" (mã {})", result.0 as isize))
    }
}

#[cfg(not(windows))]
pub fn open(path: &str, _admin: bool) -> Result<(), String> {
    Command::new("xdg-open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// "Open file location": shows the file selected in Explorer, like Windows does for a shortcut.
/// A `.lnk` is followed to its target (a box keeps its own copy of the shortcut in app data, which
/// is not what anyone wants to see). A path that no longer exists opens its nearest existing folder.
pub fn reveal(path: &str) -> Result<(), String> {
    let target = reveal_target(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("explorer");
        // explorer.exe parses its own command line: the path must be quoted *after* the comma,
        // which the default argument quoting gets wrong for paths with spaces.
        if target.is_dir() && target.parent().is_none() || !target.exists() {
            cmd.raw_arg(format!("\"{}\"", target.display()));
        } else {
            cmd.raw_arg(format!("/select,\"{}\"", target.display()));
        }
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(target.parent().unwrap_or(std::path::Path::new("/")))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

fn reveal_target(path: &str) -> std::path::PathBuf {
    use std::path::{Path, PathBuf};
    let p = Path::new(path);
    let is_lnk = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
    if is_lnk {
        if let Some(t) = crate::items::link_target(p).map(PathBuf::from).filter(|t| t.exists()) {
            return t;
        }
    }
    if p.exists() {
        return p.to_path_buf();
    }
    // Gone: open the closest folder that still exists.
    p.ancestors().skip(1).find(|a| a.is_dir()).map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("C:\\"))
}

/// Opens a web link or mail address in the default browser / mail app (About & contact).
/// Only `https://` and `mailto:` are accepted, so the command can't be used to run files.
pub fn open_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("mailto:")) {
        return Err(format!("Unsupported link: {url}"));
    }
    #[cfg(windows)]
    {
        use windows::core::{w, HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let result = unsafe { ShellExecuteW(None, w!("open"), &HSTRING::from(url), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        if result.0 as isize > 32 { Ok(()) } else { Err(format!("Could not open {url} ({})", result.0 as isize)) }
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}
