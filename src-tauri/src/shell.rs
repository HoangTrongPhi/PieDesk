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

pub fn reveal(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    let cmd = Command::new("explorer").arg(format!("/select,{path}")).spawn();
    #[cfg(not(windows))]
    let cmd = Command::new("xdg-open")
        .arg(std::path::Path::new(path).parent().unwrap_or(std::path::Path::new("/")))
        .spawn();
    cmd.map(|_| ()).map_err(|e| e.to_string())
}
