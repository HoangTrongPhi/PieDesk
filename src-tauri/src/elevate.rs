//! Admin work for the utilities (cleaning C:\Windows, services, HKLM tweaks).
//!
//! PieDesk runs as the user. Work that needs admin rights is batched into one list of tasks and
//! handed to a second copy of PieDesk started with "Run as administrator" (one UAC prompt):
//! `piedesk.exe --piedesk-elevated <tasks.json> <results.json>`. That copy does the tasks and exits
//! before Tauri starts, so it never shows a window or meets the single-instance lock.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{cleanup, optimize};

const FLAG: &str = "--piedesk-elevated";

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Task {
    Clean { ids: Vec<String> },
    Tweaks { changes: Vec<(String, Value)> },
    PurgeStandby,
    Startup { scope: String, name: String, enabled: bool },
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Outcome {
    Clean(Vec<cleanup::CleanResult>),
    Tweaks(Vec<optimize::ChangeResult>),
    Done(Result<(), String>),
}

fn perform(tasks: Vec<Task>) -> Vec<Outcome> {
    tasks
        .into_iter()
        .map(|t| match t {
            Task::Clean { ids } => Outcome::Clean(cleanup::clean_here(&ids)),
            Task::Tweaks { changes } => Outcome::Tweaks(optimize::write_all(&changes)),
            Task::PurgeStandby => Outcome::Done(optimize::purge_standby()),
            Task::Startup { scope, name, enabled } => Outcome::Done(optimize::startup_write(&scope, &name, enabled)),
        })
        .collect()
}

/// PieDesk itself runs elevated (started as admin): no prompt needed.
pub fn is_admin() -> bool {
    #[cfg(windows)]
    unsafe {
        windows::Win32::UI::Shell::IsUserAnAdmin().as_bool()
    }
    #[cfg(not(windows))]
    false
}

/// Runs the tasks with admin rights, asking through UAC unless PieDesk already has them.
/// `Err("cancelled")` when the user says no.
pub fn run(tasks: Vec<Task>) -> Result<Vec<Outcome>, String> {
    if tasks.is_empty() {
        return Ok(Vec::new());
    }
    if is_admin() {
        return Ok(perform(tasks));
    }
    run_elevated(tasks)
}

#[cfg(windows)]
fn run_elevated(tasks: Vec<Task>) -> Result<Vec<Outcome>, String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    static SEQ: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir();
    let stem = format!("piedesk-elevated-{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed));
    let input: PathBuf = dir.join(format!("{stem}.in.json"));
    let output: PathBuf = dir.join(format!("{stem}.out.json"));
    std::fs::write(&input, serde_json::to_vec(&tasks).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&output);

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let params = HSTRING::from(format!("{FLAG} \"{}\" \"{}\"", input.display(), output.display()));
    let file = HSTRING::from(exe.as_os_str());
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    let started = unsafe { ShellExecuteExW(&mut info) };
    let result = match started {
        Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => Err("cancelled".to_string()),
        Err(e) => Err(e.message()),
        Ok(()) if info.hProcess.is_invalid() => Err("no process".to_string()),
        Ok(()) => unsafe {
            // Component cleanup (DISM) can take a while.
            let waited = WaitForSingleObject(info.hProcess, 30 * 60 * 1000);
            let mut code = 0u32;
            let _ = GetExitCodeProcess(info.hProcess, &mut code);
            let _ = CloseHandle(info.hProcess);
            if waited != WAIT_OBJECT_0 {
                Err("timeout".to_string())
            } else {
                std::fs::read(&output)
                    .map_err(|e| format!("helper exited with {code}: {e}"))
                    .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
            }
        },
    };
    let _ = std::fs::remove_file(&input);
    let _ = std::fs::remove_file(&output);
    result
}

#[cfg(not(windows))]
fn run_elevated(_tasks: Vec<Task>) -> Result<Vec<Outcome>, String> {
    Err("unsupported".into())
}

/// Called first thing in `run()`: when started as the elevated helper, do the tasks and return
/// the exit code; otherwise None and PieDesk starts normally.
pub fn serve_if_requested() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let at = args.iter().position(|a| a == FLAG)?;
    let (Some(input), Some(output)) = (args.get(at + 1), args.get(at + 2)) else { return Some(2) };
    let tasks: Vec<Task> = match std::fs::read(input).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
        Some(t) => t,
        None => return Some(3),
    };
    let results = perform(tasks);
    match serde_json::to_vec(&results).ok().map(|b| std::fs::write(output, b)) {
        Some(Ok(())) => Some(0),
        _ => Some(4),
    }
}
