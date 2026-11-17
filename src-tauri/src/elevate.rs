//! Admin work for the utilities (cleaning C:\Windows, services, HKLM tweaks, uninstallers).
//!
//! PieDesk runs as the user. Work that needs admin rights is batched into a list of [`Task`]s and
//! handed to a copy of PieDesk that runs elevated:
//!
//! - **Admin helper (granted once).** The installer asks UAC once and registers a Task Scheduler
//!   task, `PieDesk\AdminHelper`, that runs `piedesk.exe --piedesk-broker` with the highest
//!   privileges. PieDesk drops a job file in `%LOCALAPPDATA%\PieDesk\elevated` and starts the
//!   task (`schtasks /run`, no prompt); the helper claims one job, does it, writes the result
//!   and exits. Utilities can revoke it (the task is deleted) or grant it again.
//! - **Fallback.** Without the task, a copy started with "Run as administrator" does the job
//!   (one UAC prompt): `piedesk.exe --piedesk-elevated <tasks.json> <results.json>`. Unless the
//!   user revoked the helper, that copy also registers it, so the prompt does not come back.
//!
//! Both copies do their work and exit before Tauri starts: no window, no single-instance lock.
//! Only the fixed set of [`Task`]s below can be asked for.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{cleanup, optimize, uninstall};

const FLAG: &str = "--piedesk-elevated";
const BROKER: &str = "--piedesk-broker";
/// Run by the installer (after copying files): grant the admin helper, one UAC prompt.
const SETUP: &str = "--piedesk-setup-admin";
/// Run by the uninstaller: remove the admin helper (through itself, no prompt).
const TEARDOWN: &str = "--piedesk-remove-admin";
/// The elevated half of SETUP / "grant" in Utilities.
const REGISTER: &str = "--piedesk-register-admin";
pub const TASK_NAME: &str = r"PieDesk\AdminHelper";

/// The task's name (tests use their own, unprivileged one).
fn task_name() -> String {
    #[cfg(test)]
    if let Ok(n) = std::env::var("PIEDESK_TEST_TASK") {
        return n;
    }
    TASK_NAME.to_string()
}

/// The executable the task starts: this one (tests point it at the built app).
fn helper_exe() -> Option<PathBuf> {
    #[cfg(test)]
    if let Ok(e) = std::env::var("PIEDESK_TEST_EXE") {
        return Some(PathBuf::from(e));
    }
    std::env::current_exe().ok()
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Task {
    Clean { ids: Vec<String> },
    Tweaks { changes: Vec<(String, Value)> },
    PurgeStandby,
    Startup { scope: String, name: String, enabled: bool },
    Leftovers { items: Vec<uninstall::Leftover>, backup: String },
    /// Runs the uninstaller of a program installed for all users (HKLM only: those entries can
    /// only be written by an admin). `file`: an installer the user picked (.msi / .exe).
    Uninstall { key: String, file: Option<String> },
    /// "Run as administrator" on a box item.
    Launch { path: String },
    /// Deletes the admin helper task (it removes itself).
    Unregister,
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Outcome {
    Clean(Vec<cleanup::CleanResult>),
    Tweaks(Vec<optimize::ChangeResult>),
    Done(Result<(), String>),
    Leftovers(Vec<uninstall::RemoveResult>),
    Code(Result<u32, String>),
}

fn perform(tasks: Vec<Task>) -> Vec<Outcome> {
    tasks
        .into_iter()
        .map(|t| match t {
            Task::Clean { ids } => Outcome::Clean(cleanup::clean_here(&ids)),
            Task::Tweaks { changes } => Outcome::Tweaks(optimize::write_all(&changes)),
            Task::PurgeStandby => Outcome::Done(optimize::purge_standby()),
            Task::Startup { scope, name, enabled } => Outcome::Done(optimize::startup_write(&scope, &name, enabled)),
            Task::Leftovers { items, backup } => Outcome::Leftovers(uninstall::remove_here(&items, Path::new(&backup))),
            Task::Uninstall { key, file } => Outcome::Code(uninstall::run_machine(&key, file.as_deref())),
            Task::Launch { path } => Outcome::Done(crate::shell::open(&path, false)),
            Task::Unregister => Outcome::Done(unregister_here()),
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

/// Runs the tasks with admin rights: in this process when PieDesk is elevated, through the admin
/// helper when it is granted, otherwise through UAC. `Err("cancelled")` when the user says no.
pub fn run(tasks: Vec<Task>) -> Result<Vec<Outcome>, String> {
    if tasks.is_empty() {
        return Ok(Vec::new());
    }
    if is_admin() {
        return Ok(perform(tasks));
    }
    let tasks = match via_helper(tasks) {
        Ok(out) => return Ok(out),
        Err(HelperError::Failed(e)) => return Err(e),
        Err(HelperError::Unavailable(tasks)) => tasks,
    };
    run_elevated(tasks, true)
}

/// Like [`run`], but only without a prompt (elevated already, or through the helper). `None`:
/// the helper is not granted — the caller does the work itself.
pub fn run_quiet(tasks: Vec<Task>) -> Option<Result<Vec<Outcome>, String>> {
    if is_admin() {
        return Some(Ok(perform(tasks)));
    }
    match via_helper(tasks) {
        Ok(out) => Some(Ok(out)),
        Err(HelperError::Failed(e)) => Some(Err(e)),
        Err(HelperError::Unavailable(_)) => None,
    }
}

// ---------------------------------------------------------------------------------------------
// Admin helper (Task Scheduler)

fn local_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir()).join("PieDesk")
}

fn queue_dir() -> PathBuf {
    #[cfg(test)]
    if let Ok(d) = std::env::var("PIEDESK_TEST_QUEUE") {
        return PathBuf::from(d);
    }
    local_dir().join("elevated")
}

/// Set when the user revoked the helper: the UAC fallback must not grant it again.
fn off_flag() -> PathBuf {
    local_dir().join("admin-helper-off")
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdminStatus {
    /// The helper task exists and runs this copy of PieDesk.
    pub granted: bool,
    /// PieDesk itself runs as admin.
    pub elevated: bool,
    /// The user turned the helper off.
    pub revoked: bool,
}

pub fn status() -> AdminStatus {
    AdminStatus { granted: helper_ready(), elevated: is_admin(), revoked: off_flag().exists() }
}

/// The task exists, is enabled and starts this executable.
#[cfg(windows)]
pub fn helper_ready() -> bool {
    let Ok(xml) = cleanup::run_hidden("schtasks", &["/query", "/tn", &task_name(), "/xml"]) else { return false };
    let Some(exe) = helper_exe() else { return false };
    let xml = xml.to_lowercase();
    // schtasks prints in the console code page: compare the whole path only when it is ASCII.
    let path = exe.to_string_lossy().to_lowercase();
    let file = exe.file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
    let same_exe = if path.is_ascii() { xml.contains(&xml_escape(&path)) } else { xml.contains(&xml_escape(&file)) };
    same_exe && xml.contains(BROKER) && !xml.contains("<enabled>false</enabled>")
}

#[cfg(not(windows))]
pub fn helper_ready() -> bool {
    false
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Task Scheduler definition: run `exe --piedesk-broker` as `user`, elevated, on demand only.
fn task_xml(exe: &str, user: &str, level: &str, queue: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>PieDesk</Author>
    <Description>PieDesk: admin work (clean up, uninstall, optimize) without a UAC prompt every time. Granted once when PieDesk was installed; PieDesk → Utilities can revoke it.</Description>
  </RegistrationInfo>
  <Triggers />
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>{level}</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT12H</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{exe}</Command>
      <Arguments>{BROKER} &quot;{queue}&quot;</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        user = xml_escape(user),
        exe = xml_escape(exe),
        level = level,
        queue = xml_escape(queue),
    )
}

/// Registers the helper task. Must run elevated.
fn register_here() -> Result<(), String> {
    register_with("HighestAvailable")
}

#[cfg(windows)]
fn register_with(level: &str) -> Result<(), String> {
    let exe = helper_exe().ok_or("no exe")?;
    let user = match (std::env::var("USERDOMAIN"), std::env::var("USERNAME")) {
        (Ok(d), Ok(u)) if !d.is_empty() => format!(r"{d}\{u}"),
        (_, Ok(u)) => u,
        _ => return Err("no user".into()),
    };
    let xml = task_xml(&exe.to_string_lossy(), &user, level, &queue_dir().to_string_lossy());
    // schtasks reads the definition as UTF-16 with a byte order mark.
    let mut bytes = vec![0xFF, 0xFE];
    bytes.extend(xml.encode_utf16().flat_map(u16::to_le_bytes));
    let file = std::env::temp_dir().join(format!("piedesk-admin-task-{}.xml", std::process::id()));
    std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    let res = cleanup::run_hidden("schtasks", &["/create", "/tn", &task_name(), "/xml", &file.to_string_lossy(), "/f"]);
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::create_dir_all(queue_dir());
    res.map(|_| ())
}

#[cfg(not(windows))]
fn register_with(_level: &str) -> Result<(), String> {
    Err("unsupported".into())
}

fn unregister_here() -> Result<(), String> {
    cleanup::run_hidden("schtasks", &["/delete", "/tn", &task_name(), "/f"]).map(|_| ())
}

/// Grants the helper (one UAC prompt) and forgets an earlier revoke.
pub fn grant() -> Result<AdminStatus, String> {
    let _ = std::fs::remove_file(off_flag());
    if !helper_ready() {
        if is_admin() {
            register_here()?;
        } else {
            launch_elevated(&[REGISTER], 60_000)?;
        }
    }
    let s = status();
    if s.granted { Ok(s) } else { Err("not granted".into()) }
}

/// Removes the helper (through itself, so without a prompt) and remembers the choice.
pub fn revoke() -> Result<AdminStatus, String> {
    if let Some(dir) = off_flag().parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(off_flag(), b"").map_err(|e| e.to_string())?;
    if helper_ready() {
        if is_admin() {
            unregister_here()?;
        } else {
            match via_helper(vec![Task::Unregister]) {
                Ok(_) => {}
                Err(HelperError::Failed(e)) => return Err(e),
                Err(HelperError::Unavailable(_)) => launch_elevated(&[TEARDOWN], 60_000).map(|_| ())?,
            }
        }
    }
    Ok(status())
}

enum HelperError {
    /// No helper (not granted, disabled, or it never picked the job up): tasks given back.
    Unavailable(Vec<Task>),
    Failed(String),
}

/// Hands the tasks to the helper task and waits for its answer.
fn via_helper(tasks: Vec<Task>) -> Result<Vec<Outcome>, HelperError> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);

    if !helper_ready() {
        return Err(HelperError::Unavailable(tasks));
    }
    let dir = queue_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return Err(HelperError::Unavailable(tasks));
    }
    let stem = format!("{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed));
    let input = dir.join(format!("{stem}.in.json"));
    let pid_file = dir.join(format!("{stem}.pid"));
    let output = dir.join(format!("{stem}.out.json"));
    let bytes = match serde_json::to_vec(&tasks) {
        Ok(b) => b,
        Err(e) => return Err(HelperError::Failed(e.to_string())),
    };
    if std::fs::write(&input, bytes).is_err() {
        return Err(HelperError::Unavailable(tasks));
    }
    let clean = || {
        for f in [&input, &pid_file, &output] {
            let _ = std::fs::remove_file(f);
        }
    };
    if cleanup::run_hidden("schtasks", &["/run", "/tn", &task_name()]).is_err() {
        clean();
        return Err(HelperError::Unavailable(tasks));
    }

    // Started: the helper writes its process id once it has claimed the job.
    let t0 = Instant::now();
    let pid = loop {
        if let Some(pid) = std::fs::read_to_string(&pid_file).ok().and_then(|s| s.trim().parse::<u32>().ok()) {
            break pid;
        }
        if t0.elapsed() > Duration::from_secs(20) {
            // Nobody took it: take the job back (unless the helper claims it right now).
            if std::fs::remove_file(&input).is_ok() {
                clean();
                return Err(HelperError::Unavailable(tasks));
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    // Done: the answer appears (written aside, then renamed), or the helper is gone without one.
    loop {
        if output.exists() {
            let res = std::fs::read(&output)
                .map_err(|e| e.to_string())
                .and_then(|b| serde_json::from_slice::<Vec<Outcome>>(&b).map_err(|e| e.to_string()));
            clean();
            return res.map_err(HelperError::Failed);
        }
        if !process_alive(pid) && !output.exists() {
            clean();
            return Err(HelperError::Failed("the admin helper stopped".into()));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            // Cannot look at it: assume it still works rather than give up on a running job.
            return true;
        };
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code).is_ok();
        let _ = CloseHandle(h);
        !ok || code == STILL_ACTIVE.0 as u32
    }
}

#[cfg(not(windows))]
fn process_alive(_pid: u32) -> bool {
    false
}

/// The helper: claims one job from the queue, does it, writes the answer. One job per start, so
/// a long uninstall never holds up a clean-up started meanwhile (each gets its own helper).
/// `dir`: the queue folder, written into the task when it was registered (a task does not
/// always get the user's environment, so %LOCALAPPDATA% may point elsewhere).
fn serve_broker(dir: Option<&str>) -> i32 {
    let dir = dir.map(PathBuf::from).unwrap_or_else(queue_dir);
    let Ok(rd) = std::fs::read_dir(&dir) else { return 1 };
    let mut jobs: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.to_string_lossy().ends_with(".in.json"))
        .collect();
    jobs.sort();
    for job in jobs {
        let name = job.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let stem = name.trim_end_matches(".in.json").to_string();
        let claimed = dir.join(format!("{stem}.run.json"));
        // The rename is the claim: only one helper wins it.
        if std::fs::rename(&job, &claimed).is_err() {
            continue;
        }
        let _ = std::fs::write(dir.join(format!("{stem}.pid")), std::process::id().to_string());
        let tasks: Option<Vec<Task>> = std::fs::read(&claimed).ok().and_then(|b| serde_json::from_slice(&b).ok());
        let _ = std::fs::remove_file(&claimed);
        let results = match tasks {
            Some(t) => std::panic::catch_unwind(|| perform(t)).unwrap_or_default(),
            None => Vec::new(),
        };
        let tmp = dir.join(format!("{stem}.out.tmp"));
        let ok = serde_json::to_vec(&results).ok().map(|b| std::fs::write(&tmp, b)).is_some_and(|r| r.is_ok())
            && std::fs::rename(&tmp, dir.join(format!("{stem}.out.json"))).is_ok();
        return if ok { 0 } else { 4 };
    }
    0
}

// ---------------------------------------------------------------------------------------------
// UAC fallback

/// Starts this executable elevated with `args` and waits for it. `Err("cancelled")` on "No".
#[cfg(windows)]
fn launch_elevated(args: &[&str], timeout_ms: u32) -> Result<u32, String> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let params = HSTRING::from(args.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.to_string() }).collect::<Vec<_>>().join(" "));
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
    match unsafe { ShellExecuteExW(&mut info) } {
        Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => Err("cancelled".to_string()),
        Err(e) => Err(e.message()),
        Ok(()) if info.hProcess.is_invalid() => Err("no process".to_string()),
        Ok(()) => unsafe {
            let waited = WaitForSingleObject(info.hProcess, timeout_ms);
            let mut code = 0u32;
            let _ = GetExitCodeProcess(info.hProcess, &mut code);
            let _ = CloseHandle(info.hProcess);
            if waited != WAIT_OBJECT_0 { Err("timeout".to_string()) } else { Ok(code) }
        },
    }
}

#[cfg(not(windows))]
fn launch_elevated(_args: &[&str], _timeout_ms: u32) -> Result<u32, String> {
    Err("unsupported".into())
}

fn run_elevated(tasks: Vec<Task>, register: bool) -> Result<Vec<Outcome>, String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir();
    let stem = format!("piedesk-elevated-{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed));
    let input: PathBuf = dir.join(format!("{stem}.in.json"));
    let output: PathBuf = dir.join(format!("{stem}.out.json"));
    std::fs::write(&input, serde_json::to_vec(&tasks).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&output);
    let (i, o) = (input.to_string_lossy().into_owned(), output.to_string_lossy().into_owned());
    let mut args = vec![FLAG, i.as_str(), o.as_str()];
    if register && !off_flag().exists() {
        args.push(REGISTER);
    }
    // Component cleanup (DISM) can take a while.
    let result = launch_elevated(&args, 30 * 60 * 1000).and_then(|code| {
        std::fs::read(&output)
            .map_err(|e| format!("helper exited with {code}: {e}"))
            .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
    });
    let _ = std::fs::remove_file(&input);
    let _ = std::fs::remove_file(&output);
    result
}

/// Called first thing in `run()`: when started as one of the helpers above, do the work and
/// return the exit code; otherwise None and PieDesk starts normally.
pub fn serve_if_requested() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let has = |f: &str| args.iter().any(|a| a == f);

    if let Some(at) = args.iter().position(|a| a == BROKER) {
        return Some(serve_broker(args.get(at + 1).map(String::as_str)));
    }
    if has(SETUP) {
        // Installer: grant once, unless the user revoked it before (an update must not ask again).
        if off_flag().exists() || helper_ready() {
            return Some(0);
        }
        return Some(match launch_elevated(&[REGISTER], 120_000) {
            Ok(code) => code as i32,
            Err(_) => 1,
        });
    }
    if has(TEARDOWN) {
        let _ = std::fs::remove_file(off_flag());
        if !helper_ready() {
            return Some(0);
        }
        if is_admin() {
            return Some(if unregister_here().is_ok() { 0 } else { 1 });
        }
        return Some(match via_helper(vec![Task::Unregister]) {
            Ok(_) => 0,
            Err(_) => 1,
        });
    }
    if let Some(at) = args.iter().position(|a| a == FLAG) {
        let (Some(input), Some(output)) = (args.get(at + 1), args.get(at + 2)) else { return Some(2) };
        let tasks: Vec<Task> = match std::fs::read(input).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
            Some(t) => t,
            None => return Some(3),
        };
        let results = perform(tasks);
        if has(REGISTER) {
            let _ = register_here();
        }
        return match serde_json::to_vec(&results).ok().map(|b| std::fs::write(output, b)) {
            Some(Ok(())) => Some(0),
            _ => Some(4),
        };
    }
    if has(REGISTER) {
        return Some(if register_here().is_ok() { 0 } else { 1 });
    }
    None
}

// ---------------------------------------------------------------------------------------------
// Commands

#[tauri::command]
pub async fn admin_status() -> AdminStatus {
    tauri::async_runtime::spawn_blocking(status).await.unwrap_or(AdminStatus { granted: false, elevated: false, revoked: false })
}

#[tauri::command]
pub async fn admin_grant() -> Result<AdminStatus, String> {
    tauri::async_runtime::spawn_blocking(grant).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn admin_revoke() -> Result<AdminStatus, String> {
    tauri::async_runtime::spawn_blocking(revoke).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_xml_escapes_and_runs_the_broker() {
        let x = task_xml(r"C:\A&B\piedesk.exe", r"PC\me", "HighestAvailable", r"C:\Q");
        assert!(x.contains(r"<Command>C:\A&amp;B\piedesk.exe</Command>"));
        assert!(x.contains(r"<Arguments>--piedesk-broker &quot;C:\Q&quot;</Arguments>"));
        assert!(x.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(x.contains(r"<UserId>PC\me</UserId>"));
    }

    #[test]
    fn tasks_round_trip() {
        let t = vec![Task::Uninstall { key: "HKLM|64|{X}".into(), file: Some(r"C:\a.msi".into()) }, Task::Unregister];
        let back: Vec<Task> = serde_json::from_slice(&serde_json::to_vec(&t).unwrap()).unwrap();
        assert!(matches!(back[0], Task::Uninstall { .. }) && matches!(back[1], Task::Unregister));
    }

    /// `cargo build` then `cargo test live_helper -- --ignored --nocapture`: registers an
    /// unprivileged copy of the helper task (no UAC), runs a job through it, removes it.
    #[test]
    #[ignore]
    fn live_helper() {
        let exe = std::env::current_dir().unwrap().join(r"target\debug\piedesk.exe");
        assert!(exe.exists(), "build first: {}", exe.display());
        std::env::set_var("PIEDESK_TEST_TASK", r"PieDesk\HelperTest");
        std::env::set_var("PIEDESK_TEST_EXE", &exe);
        // Not under %LOCALAPPDATA%: a packaged (MSIX) parent such as the Claude app virtualises it.
        std::env::set_var("PIEDESK_TEST_QUEUE", std::env::current_dir().unwrap().join(r"target\helper-test-queue"));
        register_with("LeastPrivilege").expect("register");
        assert!(helper_ready(), "task not recognised");
        let t0 = Instant::now();
        let out = match via_helper(vec![Task::PurgeStandby]) {
            Ok(o) => o,
            Err(HelperError::Failed(e)) => panic!("failed: {e}"),
            Err(HelperError::Unavailable(_)) => panic!("helper never picked the job up"),
        };
        println!("answer in {:?}: {out:?}", t0.elapsed());
        assert!(matches!(out.as_slice(), [Outcome::Done(_)]));
        unregister_here().expect("unregister");
        assert!(!helper_ready());
    }
}
