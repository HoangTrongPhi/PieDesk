//! "Start with Windows" through Task Scheduler.
//!
//! Boxes now hold the desktop's shortcuts, so until PieDesk is up the desktop looks empty. Programs
//! in the `Run` key only start after Explorer has, and Windows holds them back a few more seconds;
//! a task with a logon trigger starts as soon as the user signs in, alongside Explorer. Tasks also
//! default to "below normal" priority (7) and a 72 h run limit, so both are set explicitly.
//! If the task cannot be registered, the `Run` key (tauri-plugin-autostart) is used instead.

use std::process::Command;

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// One task per app identity, so a test build never replaces the installed app's task.
fn task_name(app: &AppHandle) -> String {
    format!("PieDesk ({})", app.config().identifier)
}

#[cfg(windows)]
fn schtasks(args: &[&str]) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new("schtasks").args(args).creation_flags(CREATE_NO_WINDOW).output().is_ok_and(|o| o.status.success())
}

#[cfg(not(windows))]
fn schtasks(_args: &[&str]) -> bool {
    false
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Task definition: logon trigger for this user, normal priority, no time limit, runs on battery.
pub fn task_xml(user: &str, exe: &str) -> String {
    let (user, exe) = (xml_escape(user), xml_escape(exe));
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Shows PieDesk boxes and widgets right after sign-in.</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>"{exe}"</Command><Arguments>--autostart</Arguments></Exec></Actions>
</Task>
"#
    )
}

fn register_task(app: &AppHandle) -> bool {
    let (Ok(exe), Some(user)) = (std::env::current_exe(), current_user()) else { return false };
    let xml = task_xml(&user, &exe.to_string_lossy());
    // schtasks reads the definition from a file, UTF-16 LE with BOM to match the declaration.
    let path = std::env::temp_dir().join(format!("piedesk-task-{}.xml", std::process::id()));
    let bytes: Vec<u8> = std::iter::once(0xFEFFu16).chain(xml.encode_utf16()).flat_map(|u| u.to_le_bytes()).collect();
    if std::fs::write(&path, bytes).is_err() {
        return false;
    }
    let ok = schtasks(&["/Create", "/F", "/TN", &task_name(app), "/XML", &path.to_string_lossy()]);
    let _ = std::fs::remove_file(path);
    ok
}

fn current_user() -> Option<String> {
    let user = std::env::var("USERNAME").ok()?;
    Some(match std::env::var("USERDOMAIN") {
        Ok(domain) if !domain.is_empty() => format!("{domain}\\{user}"),
        _ => user,
    })
}

pub fn is_enabled(app: &AppHandle) -> bool {
    schtasks(&["/Query", "/TN", &task_name(app)]) || app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turns autostart on (task first, `Run` key as fallback) or off (both).
pub fn set(app: &AppHandle, on: bool) -> bool {
    if on {
        if register_task(app) {
            let _ = app.autolaunch().disable(); // one way of starting is enough
            true
        } else {
            app.autolaunch().enable().is_ok()
        }
    } else {
        schtasks(&["/Delete", "/F", "/TN", &task_name(app)]);
        let _ = app.autolaunch().disable();
        !is_enabled(app)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_xml_escapes_and_sets_priority() {
        let xml = task_xml(r"PC\an & co", r"M:\Apps & Tools\piedesk.exe");
        assert!(xml.contains(r"<UserId>PC\an &amp; co</UserId>"));
        assert!(xml.contains(r#"<Command>"M:\Apps &amp; Tools\piedesk.exe"</Command>"#));
        assert!(xml.contains("<Priority>4</Priority>") && xml.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
    }
}
