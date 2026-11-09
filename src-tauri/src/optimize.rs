//! OptimizedPC utility (Manager → Utilities → Optimize): Windows tweaks with read / write, the
//! Gaming / Working profiles and the way back to Normal, freeing RAM, startup apps and
//! recommendations.
//!
//! The profiles themselves (which tweak gets which value) live in the frontend
//! (`src/manager/utilities/optimize.ts`); Rust only reads and writes single tweaks. The first time a
//! tweak is changed its original value is saved in `<config>/optimize.json`, so "Normal" puts back
//! exactly what the user had, however many profiles were applied in between. Admin tweaks are
//! batched into one UAC prompt (`elevate.rs`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::cleanup::run_hidden;
use crate::elevate;

// ---------------------------------------------------------------------------------------------
// Registry

#[cfg(windows)]
mod reg {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    pub fn root(hklm: bool) -> RegKey {
        RegKey::predef(if hklm { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER })
    }
    pub fn dword(hklm: bool, path: &str, name: &str) -> Option<u32> {
        root(hklm).open_subkey_with_flags(path, KEY_READ).ok()?.get_value(name).ok()
    }
    pub fn string(hklm: bool, path: &str, name: &str) -> Option<String> {
        root(hklm).open_subkey_with_flags(path, KEY_READ).ok()?.get_value(name).ok()
    }
    pub fn set_dword(hklm: bool, path: &str, name: &str, v: u32) -> Result<(), String> {
        let (key, _) = root(hklm).create_subkey_with_flags(path, KEY_WRITE).map_err(|e| format!("{path}: {e}"))?;
        key.set_value(name, &v).map_err(|e| format!("{path}\\{name}: {e}"))
    }
    pub fn set_string(hklm: bool, path: &str, name: &str, v: &str) -> Result<(), String> {
        let (key, _) = root(hklm).create_subkey_with_flags(path, KEY_WRITE).map_err(|e| format!("{path}: {e}"))?;
        key.set_value(name, &v).map_err(|e| format!("{path}\\{name}: {e}"))
    }
}

// ---------------------------------------------------------------------------------------------
// Tweaks

const GAMEBAR: &str = r"Software\Microsoft\GameBar";
const GAMECONFIG: &str = r"System\GameConfigStore";
const GAMEDVR: &str = r"Software\Microsoft\Windows\CurrentVersion\GameDVR";
const GRAPHICS: &str = r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers";
const GPU_PREFS: &str = r"Software\Microsoft\DirectX\UserGpuPreferences";
const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
const BACKGROUND: &str = r"Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications";
const PUSH: &str = r"Software\Microsoft\Windows\CurrentVersion\PushNotifications";
const MM_PROFILE: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile";
const MM_GAMES: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games";

pub const GUID_BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
pub const GUID_HIGH: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
pub const GUID_ULTIMATE: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";

/// Every tweak, in the order they are applied (the power plan before its sleep timeout).
pub const TWEAKS: &[(&str, bool, bool)] = &[
    // (id, needs admin, needs a restart)
    ("power_plan", false, false),
    ("standby_ac", false, false),
    ("game_mode", false, false),
    ("game_dvr", false, false),
    ("hags", true, true),
    ("windowed_opt", false, false),
    ("mouse_accel", false, false),
    ("transparency", false, false),
    ("animations", false, false),
    ("background_apps", false, false),
    ("notifications", false, false),
    ("mmcss_games", true, false),
    ("svc_sysmain", true, false),
    ("svc_search", true, false),
    ("svc_diagtrack", true, false),
];

fn is_admin_tweak(id: &str) -> bool {
    TWEAKS.iter().any(|(t, admin, _)| *t == id && *admin)
}

fn order(id: &str) -> usize {
    TWEAKS.iter().position(|(t, _, _)| *t == id).unwrap_or(usize::MAX)
}

fn service_of(id: &str) -> Option<&'static str> {
    match id {
        "svc_sysmain" => Some("SysMain"),
        "svc_search" => Some("WSearch"),
        "svc_diagtrack" => Some("DiagTrack"),
        _ => None,
    }
}

/// The current value of a tweak: bool, a number (standby seconds) or a power plan GUID.
#[cfg(windows)]
pub fn read(id: &str) -> Option<Value> {
    let flag = |b: bool| Some(Value::Bool(b));
    match id {
        "power_plan" => active_plan().map(|(guid, _)| Value::String(guid)),
        "standby_ac" => standby_ac().map(|s| json!(s)),
        "game_mode" => flag(reg::dword(false, GAMEBAR, "AutoGameModeEnabled").map_or(true, |v| v != 0)),
        "game_dvr" => flag(reg::dword(false, GAMECONFIG, "GameDVR_Enabled").map_or(true, |v| v != 0)),
        "hags" => flag(reg::dword(true, GRAPHICS, "HwSchMode") == Some(2)),
        "windowed_opt" => flag(
            reg::string(false, GPU_PREFS, "DirectXUserGlobalSettings")
                .is_some_and(|s| kv_get(&s, "SwapEffectUpgradeEnable").as_deref() == Some("1")),
        ),
        "mouse_accel" => flag(spi::mouse()?[2] != 0),
        "transparency" => flag(reg::dword(false, PERSONALIZE, "EnableTransparency").map_or(true, |v| v != 0)),
        "animations" => flag(spi::animations()?),
        "background_apps" => flag(reg::dword(false, BACKGROUND, "GlobalUserDisabled") != Some(1)),
        "notifications" => flag(reg::dword(false, PUSH, "ToastEnabled").map_or(true, |v| v != 0)),
        "mmcss_games" => flag(
            reg::dword(true, MM_GAMES, "Priority") == Some(6)
                && reg::string(true, MM_GAMES, "Scheduling Category").as_deref() == Some("High"),
        ),
        other => service_of(other).and_then(service_running).map(Value::Bool),
    }
}
#[cfg(not(windows))]
pub fn read(_id: &str) -> Option<Value> {
    None
}

/// Writes one tweak in this process (the caller made sure about admin rights).
#[cfg(windows)]
pub fn write(id: &str, value: &Value) -> Result<(), String> {
    let on = value.as_bool();
    let need = || on.ok_or_else(|| format!("{id}: expected true / false"));
    match id {
        "power_plan" => set_plan(value.as_str().ok_or("power_plan: expected a name")?),
        "standby_ac" => {
            let secs = value.as_u64().ok_or("standby_ac: expected seconds")?;
            run_hidden("powercfg", &["/setacvalueindex", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE", &secs.to_string()])?;
            run_hidden("powercfg", &["/setactive", "SCHEME_CURRENT"]).map(drop)
        }
        "game_mode" => reg::set_dword(false, GAMEBAR, "AutoGameModeEnabled", need()? as u32),
        "game_dvr" => {
            let v = need()? as u32;
            reg::set_dword(false, GAMECONFIG, "GameDVR_Enabled", v)?;
            reg::set_dword(false, GAMEDVR, "AppCaptureEnabled", v)
        }
        "hags" => reg::set_dword(true, GRAPHICS, "HwSchMode", if need()? { 2 } else { 1 }),
        "windowed_opt" => {
            let current = reg::string(false, GPU_PREFS, "DirectXUserGlobalSettings").unwrap_or_default();
            reg::set_string(false, GPU_PREFS, "DirectXUserGlobalSettings", &kv_set(&current, "SwapEffectUpgradeEnable", if need()? { "1" } else { "0" }))
        }
        "mouse_accel" => spi::set_mouse(if need()? { [6, 10, 1] } else { [0, 0, 0] }),
        "transparency" => {
            reg::set_dword(false, PERSONALIZE, "EnableTransparency", need()? as u32)?;
            spi::broadcast("ImmersiveColorSet");
            Ok(())
        }
        "animations" => spi::set_animations(need()?),
        "background_apps" => reg::set_dword(false, BACKGROUND, "GlobalUserDisabled", if need()? { 0 } else { 1 }),
        "notifications" => reg::set_dword(false, PUSH, "ToastEnabled", need()? as u32),
        "mmcss_games" => {
            let on = need()?;
            reg::set_dword(true, MM_PROFILE, "SystemResponsiveness", if on { 10 } else { 20 })?;
            reg::set_dword(true, MM_PROFILE, "NetworkThrottlingIndex", if on { 0xffff_ffff } else { 10 })?;
            reg::set_dword(true, MM_GAMES, "GPU Priority", 8)?;
            reg::set_dword(true, MM_GAMES, "Priority", if on { 6 } else { 2 })?;
            reg::set_string(true, MM_GAMES, "Scheduling Category", if on { "High" } else { "Medium" })?;
            reg::set_string(true, MM_GAMES, "SFIO Priority", if on { "High" } else { "Normal" })
        }
        other => match service_of(other) {
            Some(svc) => service_set(svc, need()?).map(drop),
            None => Err(format!("unknown tweak {other}")),
        },
    }
}
#[cfg(not(windows))]
pub fn write(id: &str, _value: &Value) -> Result<(), String> {
    Err(format!("{id}: unsupported"))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResult {
    pub id: String,
    pub ok: bool,
    pub error: Option<String>,
}

pub fn write_all(changes: &[(String, Value)]) -> Vec<ChangeResult> {
    changes
        .iter()
        .map(|(id, v)| {
            let r = write(id, v);
            ChangeResult { id: id.clone(), ok: r.is_ok(), error: r.err() }
        })
        .collect()
}

/// `a=1;b=2;` settings strings (DirectX user preferences).
fn kv_get(s: &str, key: &str) -> Option<String> {
    s.split(';').filter_map(|p| p.split_once('=')).find(|(k, _)| k.trim() == key).map(|(_, v)| v.trim().to_string())
}

fn kv_set(s: &str, key: &str, value: &str) -> String {
    let mut out: Vec<String> = s.split(';').filter(|p| !p.trim().is_empty() && p.split_once('=').map(|(k, _)| k.trim()) != Some(key)).map(str::to_owned).collect();
    out.push(format!("{key}={value}"));
    out.join(";") + ";"
}

// --- SystemParametersInfo

#[cfg(windows)]
mod spi {
    use std::ffi::c_void;
    use windows::core::w;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, SystemParametersInfoW, ANIMATIONINFO, HWND_BROADCAST, SMTO_ABORTIFHUNG, SPIF_SENDCHANGE,
        SPIF_UPDATEINIFILE, SPI_GETANIMATION, SPI_GETCLIENTAREAANIMATION, SPI_GETMOUSE, SPI_SETANIMATION,
        SPI_SETCLIENTAREAANIMATION, SPI_SETMOUSE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WM_SETTINGCHANGE,
    };

    const SAVE: SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS = SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(SPIF_UPDATEINIFILE.0 | SPIF_SENDCHANGE.0);

    pub fn mouse() -> Option<[i32; 3]> {
        let mut v = [0i32; 3];
        unsafe { SystemParametersInfoW(SPI_GETMOUSE, 0, Some(v.as_mut_ptr() as *mut c_void), Default::default()) }.ok()?;
        Some(v)
    }
    pub fn set_mouse(mut v: [i32; 3]) -> Result<(), String> {
        unsafe { SystemParametersInfoW(SPI_SETMOUSE, 0, Some(v.as_mut_ptr() as *mut c_void), SAVE) }.map_err(|e| e.message())
    }
    pub fn animations() -> Option<bool> {
        let mut on = windows::core::BOOL(0);
        unsafe { SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, Some(&mut on as *mut _ as *mut c_void), Default::default()) }.ok()?;
        Some(on.as_bool())
    }
    pub fn set_animations(on: bool) -> Result<(), String> {
        unsafe {
            // Client-area animations take the BOOL as the pointer value itself.
            SystemParametersInfoW(SPI_SETCLIENTAREAANIMATION, 0, Some(on as usize as *mut c_void), SAVE).map_err(|e| e.message())?;
            let mut info = ANIMATIONINFO { cbSize: std::mem::size_of::<ANIMATIONINFO>() as u32, iMinAnimate: 0 };
            let _ = SystemParametersInfoW(SPI_GETANIMATION, info.cbSize, Some(&mut info as *mut _ as *mut c_void), Default::default());
            info.iMinAnimate = on as i32;
            SystemParametersInfoW(SPI_SETANIMATION, info.cbSize, Some(&mut info as *mut _ as *mut c_void), SAVE).map_err(|e| e.message())
        }
    }
    pub fn broadcast(area: &str) {
        let area = windows::core::HSTRING::from(area);
        let _ = w!("");
        unsafe {
            let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(area.as_ptr() as isize), SMTO_ABORTIFHUNG, 1000, None);
        }
    }
}

// --- Power

fn find_guid(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    (0..bytes.len().saturating_sub(35)).find_map(|i| {
        let s = text.get(i..i + 36)?;
        let ok = s.char_indices().all(|(j, c)| if [8, 13, 18, 23].contains(&j) { c == '-' } else { c.is_ascii_hexdigit() });
        ok.then(|| s.to_lowercase())
    })
}

/// Active plan GUID and its (localized) name.
pub fn active_plan() -> Option<(String, String)> {
    let out = run_hidden("powercfg", &["/getactivescheme"]).ok()?;
    let guid = find_guid(&out)?;
    let name = out.rsplit_once('(').map(|(_, n)| n.trim().trim_end_matches(')').to_string()).unwrap_or_default();
    Some((guid, name))
}

fn plans() -> Vec<String> {
    run_hidden("powercfg", &["/list"]).map(|out| out.lines().filter_map(find_guid).collect()).unwrap_or_default()
}

/// Sleep-after on mains power, in seconds (0 = never).
fn standby_ac() -> Option<u64> {
    let out = run_hidden("powercfg", &["/q", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"]).ok()?;
    // The labels are localized; the last two hex numbers are the AC and DC values.
    let hex: Vec<u64> = out
        .split_whitespace()
        .filter_map(|w| w.strip_prefix("0x").and_then(|h| u64::from_str_radix(h, 16).ok()))
        .collect();
    (hex.len() >= 2).then(|| hex[hex.len() - 2])
}

/// "ultimate" / "high" / "balanced" or a plan GUID. Ultimate Performance is hidden until it is
/// duplicated; the copy's GUID is remembered so applying Gaming again does not add more copies.
#[cfg(windows)]
fn set_plan(target: &str) -> Result<(), String> {
    let have = plans();
    let guid = match target {
        "balanced" => GUID_BALANCED.to_string(),
        "high" => {
            if have.iter().any(|g| g == GUID_HIGH) {
                GUID_HIGH.to_string()
            } else {
                duplicate_plan(GUID_HIGH)?
            }
        }
        "ultimate" => {
            let saved = load_state_at(&state_path_global()).ultimate;
            match saved.filter(|g| have.contains(g)) {
                Some(g) => g,
                None => match duplicate_plan(GUID_ULTIMATE) {
                    Ok(g) => {
                        let path = state_path_global();
                        let mut st = load_state_at(&path);
                        st.ultimate = Some(g.clone());
                        save_state_at(&path, &st);
                        g
                    }
                    // Modern Standby laptops only allow Balanced copies: fall back to High.
                    Err(_) => return set_plan("high"),
                },
            }
        }
        g => g.to_lowercase(),
    };
    run_hidden("powercfg", &["/setactive", &guid]).map(drop)
}

#[cfg(windows)]
fn duplicate_plan(template: &str) -> Result<String, String> {
    let out = run_hidden("powercfg", &["-duplicatescheme", template])?;
    find_guid(&out).ok_or_else(|| "powercfg: no GUID".into())
}

// --- Services

#[cfg(windows)]
fn service_running(name: &str) -> Option<bool> {
    use windows::core::HSTRING;
    use windows::Win32::System::Services::*;
    unsafe {
        let scm = OpenSCManagerW(None, None, SC_MANAGER_CONNECT).ok()?;
        let svc = OpenServiceW(scm, &HSTRING::from(name), SERVICE_QUERY_STATUS);
        let result = svc.ok().and_then(|svc| {
            let mut status = SERVICE_STATUS::default();
            let r = QueryServiceStatus(svc, &mut status).ok().map(|_| {
                matches!(status.dwCurrentState, SERVICE_RUNNING | SERVICE_START_PENDING | SERVICE_CONTINUE_PENDING)
            });
            let _ = CloseServiceHandle(svc);
            r
        });
        let _ = CloseServiceHandle(scm);
        result
    }
}
#[cfg(not(windows))]
fn service_running(_name: &str) -> Option<bool> {
    None
}

/// Starts or stops a service (this session only: the startup type stays as it is).
/// Returns whether anything changed.
#[cfg(windows)]
pub fn service_set(name: &str, run: bool) -> Result<bool, String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Services::*;
    if service_running(name) == Some(run) {
        return Ok(false);
    }
    unsafe {
        let scm = OpenSCManagerW(None, None, SC_MANAGER_CONNECT).map_err(|e| e.message())?;
        let svc = match OpenServiceW(scm, &HSTRING::from(name), SERVICE_QUERY_STATUS | SERVICE_START | SERVICE_STOP) {
            Ok(s) => s,
            Err(e) => {
                let _ = CloseServiceHandle(scm);
                return Err(format!("{name}: {}", e.message()));
            }
        };
        let r = if run {
            StartServiceW(svc, None).map_err(|e| format!("{name}: {}", e.message()))
        } else {
            let mut status = SERVICE_STATUS::default();
            ControlService(svc, SERVICE_CONTROL_STOP, &mut status).map_err(|e| format!("{name}: {}", e.message()))
        };
        // Wait (up to ~10 s) for the service to get there.
        if r.is_ok() {
            for _ in 0..40 {
                let mut status = SERVICE_STATUS::default();
                if QueryServiceStatus(svc, &mut status).is_err() {
                    break;
                }
                let done = if run { status.dwCurrentState == SERVICE_RUNNING } else { status.dwCurrentState == SERVICE_STOPPED };
                if done {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        }
        let _ = CloseServiceHandle(svc);
        let _ = CloseServiceHandle(scm);
        r.map(|_| true)
    }
}
#[cfg(not(windows))]
pub fn service_set(_name: &str, _run: bool) -> Result<bool, String> {
    Err("unsupported".into())
}

// ---------------------------------------------------------------------------------------------
// Memory

/// Trims the working set of every process we may touch (Windows pages it back in on demand).
#[cfg(windows)]
fn trim_working_sets() {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::ProcessStatus::K32EmptyWorkingSet;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA};
    let Ok(mut sys) = sysinfo::System::new() else { return };
    sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, sysinfo::ProcessRefreshKind::nothing());
    for pid in sys.processes().keys() {
        unsafe {
            if let Ok(h) = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION, false, pid.as_u32()) {
                let _ = K32EmptyWorkingSet(h);
                let _ = CloseHandle(h);
            }
        }
    }
}

/// Empties the standby list (cached file pages): the "ISLC" fix for stutter. Admin only.
#[cfg(windows)]
pub fn purge_standby() -> Result<(), String> {
    use windows::core::w;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, LUID};
    use windows::Win32::Security::{
        AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES,
        TOKEN_PRIVILEGES, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    #[link(name = "ntdll")]
    extern "system" {
        fn NtSetSystemInformation(class: i32, info: *mut std::ffi::c_void, len: u32) -> i32;
    }
    const SYSTEM_MEMORY_LIST_INFORMATION: i32 = 80;
    const MEMORY_PURGE_STANDBY_LIST: i32 = 4;
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &mut token).map_err(|e| e.message())?;
        let mut luid = LUID::default();
        let looked = LookupPrivilegeValueW(None, w!("SeProfileSingleProcessPrivilege"), &mut luid);
        if looked.is_ok() {
            let tp = TOKEN_PRIVILEGES { PrivilegeCount: 1, Privileges: [LUID_AND_ATTRIBUTES { Luid: luid, Attributes: SE_PRIVILEGE_ENABLED }] };
            let _ = AdjustTokenPrivileges(token, false, Some(&tp), 0, None, None);
        }
        let _ = CloseHandle(token);
        let mut command = MEMORY_PURGE_STANDBY_LIST;
        let status = NtSetSystemInformation(SYSTEM_MEMORY_LIST_INFORMATION, &mut command as *mut i32 as *mut _, 4);
        if status == 0 {
            Ok(())
        } else {
            Err(format!("NtSetSystemInformation 0x{:08x}", status as u32))
        }
    }
}
#[cfg(not(windows))]
pub fn purge_standby() -> Result<(), String> {
    Err("unsupported".into())
}

fn available_memory() -> (u64, u64) {
    let Ok(mut sys) = sysinfo::System::new() else { return (0, 0) };
    sys.refresh_memory();
    (sys.available_memory(), sys.total_memory())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamReport {
    pub before: u64,
    pub after: u64,
    pub total: u64,
    /// The standby list was purged too (needs admin; None when not asked).
    pub standby: Option<Result<(), String>>,
}

/// `deep` also purges the standby list (one UAC prompt unless PieDesk is admin).
pub fn free_ram(deep: bool) -> RamReport {
    let (before, total) = available_memory();
    #[cfg(windows)]
    trim_working_sets();
    let standby = deep.then(|| match elevate::run(vec![elevate::Task::PurgeStandby]) {
        Ok(mut out) => match out.pop() {
            Some(elevate::Outcome::Done(r)) => r,
            _ => Err("no result".into()),
        },
        Err(e) => Err(e),
    });
    std::thread::sleep(std::time::Duration::from_millis(400));
    let (after, _) = available_memory();
    RamReport { before, after, total, standby }
}

// ---------------------------------------------------------------------------------------------
// State: originals for "Normal", closed apps, the active profile

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct OptState {
    /// Profile last applied ("gaming", "working", "custom"); None = normal.
    pub profile: Option<String>,
    /// Value of every tweak before PieDesk first changed it.
    pub originals: BTreeMap<String, Value>,
    /// Programs closed by a profile, started again by Normal.
    pub closed: Vec<String>,
    /// GUID of our copy of the Ultimate Performance plan.
    pub ultimate: Option<String>,
}

static STATE_PATH: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

fn state_path_global() -> PathBuf {
    STATE_PATH.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("piedesk-optimize.json"))
}

fn state_path(app: &AppHandle) -> PathBuf {
    let path = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir()).join("optimize.json");
    let _ = STATE_PATH.set(path.clone());
    path
}

fn load_state_at(path: &Path) -> OptState {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_state_at(path: &Path, st: &OptState) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, serde_json::to_vec_pretty(st).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakState {
    pub id: &'static str,
    pub value: Option<Value>,
    pub admin: bool,
    pub reboot: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub profile: Option<String>,
    pub tweaks: Vec<TweakState>,
    /// Name of the active power plan as Windows shows it.
    pub plan_name: String,
    pub is_admin: bool,
    /// Tweaks with a saved original ("Normal" would change them back).
    pub changed: Vec<String>,
    pub closed: Vec<String>,
    pub ultimate: Option<String>,
}

pub fn overview(app: &AppHandle) -> Overview {
    let st = load_state_at(&state_path(app));
    Overview {
        tweaks: TWEAKS.iter().map(|(id, admin, reboot)| TweakState { id, value: read(id), admin: *admin, reboot: *reboot }).collect(),
        plan_name: active_plan().map(|(_, n)| n).unwrap_or_default(),
        is_admin: elevate::is_admin(),
        changed: st.originals.keys().cloned().collect(),
        closed: st.closed,
        profile: st.profile,
        ultimate: st.ultimate,
    }
}

#[derive(Deserialize, Debug)]
pub struct Change {
    pub id: String,
    pub value: Value,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub results: Vec<ChangeResult>,
    /// Tweaks already at the wanted value.
    pub unchanged: Vec<String>,
    pub closed: Vec<String>,
    pub relaunched: Vec<String>,
    pub ram: Option<RamReport>,
    /// A changed tweak only takes effect after a restart.
    pub reboot: bool,
}

/// Writes changes: user tweaks here, admin ones (and a standby purge) in one elevated batch.
fn apply_changes(mut changes: Vec<(String, Value)>, purge: bool) -> (Vec<ChangeResult>, Option<Result<(), String>>) {
    changes.sort_by_key(|(id, _)| order(id));
    let (admin, user): (Vec<_>, Vec<_>) = changes.into_iter().partition(|(id, _)| is_admin_tweak(id));
    let mut results = write_all(&user);
    let mut purged = None;
    let mut tasks = Vec::new();
    if !admin.is_empty() {
        tasks.push(elevate::Task::Tweaks { changes: admin.clone() });
    }
    if purge {
        tasks.push(elevate::Task::PurgeStandby);
    }
    match elevate::run(tasks) {
        Ok(out) => {
            for o in out {
                match o {
                    elevate::Outcome::Tweaks(r) => results.extend(r),
                    elevate::Outcome::Done(r) => purged = Some(r),
                    _ => {}
                }
            }
        }
        Err(e) => {
            results.extend(admin.iter().map(|(id, _)| ChangeResult { id: id.clone(), ok: false, error: Some(e.clone()) }));
            if purge {
                purged = Some(Err(e));
            }
        }
    }
    (results, purged)
}

/// Process names (`OneDrive.exe`) to close: returns the exe paths of what was closed.
fn close_apps(names: &[String]) -> Vec<String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let Ok(mut sys) = System::new() else { return Default::default() };
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
    let me = std::process::id();
    let wanted: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mut closed = Vec::new();
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy().to_lowercase();
        if p.pid().as_u32() == me || !wanted.contains(&name) {
            continue;
        }
        if let Some(exe) = p.exe() {
            let exe = exe.to_string_lossy().into_owned();
            if !closed.contains(&exe) {
                closed.push(exe);
            }
        }
        p.kill();
    }
    closed
}

fn relaunch(paths: &[String]) -> Vec<String> {
    let mut started = Vec::new();
    for exe in paths {
        if !Path::new(exe).exists() {
            continue;
        }
        let mut cmd = std::process::Command::new(exe);
        let name = Path::new(exe).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        if name == "onedrive.exe" {
            cmd.arg("/background");
        }
        if let Some(dir) = Path::new(exe).parent() {
            cmd.current_dir(dir);
        }
        if cmd.spawn().is_ok() {
            started.push(exe.clone());
        }
    }
    started
}

pub fn apply(app: &AppHandle, profile: Option<String>, changes: Vec<Change>, close: Vec<String>, free: bool) -> ApplyReport {
    let path = state_path(app);
    let mut st = load_state_at(&path);
    let mut report = ApplyReport::default();
    let mut todo = Vec::new();
    let mut fresh = Vec::new();
    for c in changes {
        let current = read(&c.id);
        if current.as_ref() == Some(&c.value) || (c.id == "power_plan" && plan_matches(current.as_ref(), &c.value, &st)) {
            report.unchanged.push(c.id);
            continue;
        }
        if let Some(cur) = current {
            if !st.originals.contains_key(&c.id) {
                st.originals.insert(c.id.clone(), cur);
                fresh.push(c.id.clone());
            }
        }
        todo.push((c.id, c.value));
    }
    let before = free.then(available_memory);
    #[cfg(windows)]
    if free {
        trim_working_sets();
    }
    let (results, purged) = apply_changes(todo, free);
    // A change that did not happen has nothing to undo.
    for r in results.iter().filter(|r| !r.ok) {
        if fresh.contains(&r.id) {
            st.originals.remove(&r.id);
        }
    }
    report.reboot = results.iter().any(|r| r.ok && TWEAKS.iter().any(|(t, _, reboot)| *t == r.id && *reboot));
    report.results = results;
    report.closed = close_apps(&close);
    for exe in &report.closed {
        if !st.closed.contains(exe) {
            st.closed.push(exe.clone());
        }
    }
    if let Some((before, total)) = before {
        std::thread::sleep(std::time::Duration::from_millis(400));
        report.ram = Some(RamReport { before, after: available_memory().0, total, standby: purged });
    }
    if let Some(p) = profile {
        st.profile = Some(p);
    } else if !st.originals.is_empty() && st.profile.is_none() {
        st.profile = Some("custom".into());
    }
    save_state_at(&path, &st);
    report
}

/// "ultimate" is already active when the active plan is our Ultimate copy, and so on.
fn plan_matches(current: Option<&Value>, target: &Value, st: &OptState) -> bool {
    let (Some(cur), Some(t)) = (current.and_then(Value::as_str), target.as_str()) else { return false };
    match t {
        "balanced" => cur == GUID_BALANCED,
        "high" => cur == GUID_HIGH,
        "ultimate" => st.ultimate.as_deref() == Some(cur) || cur == GUID_ULTIMATE,
        g => g.eq_ignore_ascii_case(cur),
    }
}

/// Back to Normal: every saved original is written back, closed apps start again.
pub fn restore(app: &AppHandle) -> ApplyReport {
    let path = state_path(app);
    let mut st = load_state_at(&path);
    let changes: Vec<(String, Value)> = st.originals.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let (results, _) = apply_changes(changes, false);
    let mut report = ApplyReport::default();
    for r in &results {
        if r.ok {
            st.originals.remove(&r.id);
        }
    }
    report.reboot = results.iter().any(|r| r.ok && TWEAKS.iter().any(|(t, _, reboot)| *t == r.id && *reboot));
    report.results = results;
    report.relaunched = relaunch(&st.closed);
    st.closed.clear();
    st.profile = if st.originals.is_empty() { None } else { Some("custom".into()) };
    save_state_at(&path, &st);
    report
}

// ---------------------------------------------------------------------------------------------
// Startup apps (what Task Manager's Startup page shows, minus tasks and packaged apps)

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN32: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupEntry {
    pub name: String,
    pub command: String,
    /// Program (or shortcut) to show the icon of.
    pub path: String,
    /// user | machine | machine32 | folder | commonFolder
    pub scope: String,
    pub enabled: bool,
    pub admin: bool,
}

/// (registry root is HKLM, approval subkey) for a scope.
fn approval(scope: &str) -> Option<(bool, &'static str)> {
    Some(match scope {
        "user" => (false, "Run"),
        "machine" => (true, "Run"),
        "machine32" => (true, "Run32"),
        "folder" => (false, "StartupFolder"),
        "commonFolder" => (true, "StartupFolder"),
        _ => return None,
    })
}

/// The program in a command line: `"C:\a b\x.exe" --flag` or `C:\x.exe -y`.
fn program_of(command: &str) -> String {
    let c = command.trim();
    let raw = if let Some(rest) = c.strip_prefix('"') {
        rest.split('"').next().unwrap_or(rest).to_string()
    } else if let Some(i) = c.to_lowercase().find(".exe") {
        c[..i + 4].to_string()
    } else {
        c.split_whitespace().next().unwrap_or(c).to_string()
    };
    // %ProgramFiles% and friends.
    let mut out = String::new();
    let mut parts = raw.split('%');
    out.push_str(parts.next().unwrap_or(""));
    let mut odd = true;
    for p in parts {
        if odd {
            match std::env::var(p) {
                Ok(v) => out.push_str(&v),
                Err(_) => {
                    out.push('%');
                    out.push_str(p);
                    out.push('%');
                }
            }
        } else {
            out.push_str(p);
        }
        odd = !odd;
    }
    out
}

#[cfg(windows)]
fn approved_enabled(hklm: bool, sub: &str, name: &str) -> bool {
    use winreg::enums::KEY_READ;
    let Ok(key) = reg::root(hklm).open_subkey_with_flags(format!(r"{APPROVED}\{sub}"), KEY_READ) else { return true };
    match key.get_raw_value(name) {
        Ok(v) => v.bytes.first().is_none_or(|b| b & 1 == 0),
        Err(_) => true,
    }
}

#[cfg(windows)]
pub fn startup_list() -> Vec<StartupEntry> {
    use winreg::enums::KEY_READ;
    let mut out = Vec::new();
    for (scope, hklm, path) in [("user", false, RUN), ("machine", true, RUN), ("machine32", true, RUN32)] {
        let Ok(key) = reg::root(hklm).open_subkey_with_flags(path, KEY_READ) else { continue };
        let (_, sub) = approval(scope).unwrap();
        for (name, _) in key.enum_values().flatten() {
            let Ok(command) = key.get_value::<String, _>(&name) else { continue };
            // Some installers park data in Run (ids, counters): only commands that start a program.
            let program = program_of(&command);
            if !program.contains('\\') && !program.to_lowercase().ends_with(".exe") {
                continue;
            }
            out.push(StartupEntry {
                enabled: approved_enabled(hklm, sub, &name),
                path: program_of(&command),
                name,
                command,
                scope: scope.into(),
                admin: hklm,
            });
        }
    }
    let folders = [
        ("folder", false, std::env::var("APPDATA").ok().map(|a| PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs\Startup"))),
        ("commonFolder", true, std::env::var("PROGRAMDATA").ok().map(|a| PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs\StartUp"))),
    ];
    for (scope, hklm, dir) in folders {
        let Some(dir) = dir else { continue };
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let file = e.file_name().to_string_lossy().into_owned();
            if file.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }
            let path = e.path().to_string_lossy().into_owned();
            out.push(StartupEntry {
                enabled: approved_enabled(hklm, "StartupFolder", &file),
                name: file.rsplit_once('.').map_or(file.clone(), |(n, _)| n.to_string()),
                command: path.clone(),
                path,
                scope: scope.into(),
                admin: hklm,
            });
        }
    }
    out
}
#[cfg(not(windows))]
pub fn startup_list() -> Vec<StartupEntry> {
    Vec::new()
}

/// Turns a startup entry on / off the way Task Manager does (StartupApproved), so it can be
/// turned back on there too. `name` is the value name, or the file name for folder entries.
#[cfg(windows)]
pub fn startup_write(scope: &str, name: &str, enabled: bool) -> Result<(), String> {
    use winreg::enums::{KEY_WRITE, REG_BINARY};
    use winreg::RegValue;
    let (hklm, sub) = approval(scope).ok_or("unknown scope")?;
    let mut bytes = vec![if enabled { 2u8 } else { 3u8 }, 0, 0, 0];
    let filetime = if enabled {
        0u64
    } else {
        let since_1601 = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64 / 100) + 116_444_736_000_000_000;
        since_1601
    };
    bytes.extend_from_slice(&filetime.to_le_bytes());
    let (key, _) = reg::root(hklm).create_subkey_with_flags(format!(r"{APPROVED}\{sub}"), KEY_WRITE).map_err(|e| e.to_string())?;
    key.set_raw_value(name, &RegValue { bytes, vtype: REG_BINARY }).map_err(|e| e.to_string())
}
#[cfg(not(windows))]
pub fn startup_write(_scope: &str, _name: &str, _enabled: bool) -> Result<(), String> {
    Err("unsupported".into())
}

// ---------------------------------------------------------------------------------------------
// Recommendations

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rec {
    pub id: &'static str,
    /// good | info | warn
    pub level: &'static str,
    pub data: Value,
}

#[cfg(windows)]
fn uptime_secs() -> u64 {
    unsafe { windows::Win32::System::SystemInformation::GetTickCount64() / 1000 }
}
#[cfg(not(windows))]
fn uptime_secs() -> u64 {
    0
}

#[cfg(windows)]
fn on_battery() -> bool {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut s) }.is_ok() && s.ACLineStatus == 0
}
#[cfg(not(windows))]
fn on_battery() -> bool {
    false
}

pub fn analyze(app: &AppHandle) -> Vec<Rec> {
    let mut recs = Vec::new();
    let st = load_state_at(&state_path(app));
    let drives = crate::cleanup::drives();
    if let Some(sys) = drives.iter().find(|d| d.system) {
        let pct = sys.free as f64 / sys.total.max(1) as f64;
        if pct < 0.15 {
            recs.push(Rec { id: "disk_low", level: "warn", data: json!({ "free": sys.free, "total": sys.total, "mount": sys.mount }) });
        }
    }
    let (avail, total) = available_memory();
    if total > 0 && (total - avail) as f64 / total as f64 > 0.8 {
        recs.push(Rec { id: "ram_high", level: "warn", data: json!({ "used": total - avail, "total": total }) });
    }
    let days = uptime_secs() / 86_400;
    if days >= 7 {
        recs.push(Rec { id: "uptime", level: "info", data: json!({ "days": days }) });
    }
    let startup = startup_list();
    let on = startup.iter().filter(|s| s.enabled).count();
    if on > 8 {
        recs.push(Rec { id: "startup_many", level: "warn", data: json!({ "count": on }) });
    }
    if let Some(Value::String(plan)) = read("power_plan") {
        if plan == GUID_BALANCED || plan == "a1841308-3541-4fab-bc81-f71556f20b4a" {
            recs.push(Rec { id: "power_balanced", level: "info", data: json!({ "name": active_plan().map(|(_, n)| n).unwrap_or_default() }) });
        }
    }
    if read("game_dvr") == Some(Value::Bool(true)) {
        recs.push(Rec { id: "game_dvr_on", level: "info", data: Value::Null });
    }
    if read("game_mode") == Some(Value::Bool(false)) {
        recs.push(Rec { id: "game_mode_off", level: "info", data: Value::Null });
    }
    if read("svc_diagtrack") == Some(Value::Bool(true)) {
        recs.push(Rec { id: "telemetry_on", level: "info", data: Value::Null });
    }
    let hiber = drives.iter().find(|d| d.system).map(|_| {
        let root = format!("{}\\", std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()));
        std::fs::read_dir(root).ok().and_then(|rd| rd.flatten().find(|e| e.file_name().eq_ignore_ascii_case("hiberfil.sys"))).and_then(|e| e.metadata().ok()).map_or(0, |m| m.len())
    });
    if let Some(size) = hiber.filter(|s| *s > 2 << 30) {
        recs.push(Rec { id: "hiberfil", level: "info", data: json!({ "size": size }) });
    }
    if on_battery() {
        recs.push(Rec { id: "on_battery", level: "info", data: Value::Null });
    }
    if st.profile.is_some() {
        recs.push(Rec { id: "profile_active", level: "good", data: json!({ "profile": st.profile }) });
    }
    if recs.iter().all(|r| r.level != "warn") {
        recs.push(Rec { id: "all_good", level: "good", data: Value::Null });
    }
    recs
}

// ---------------------------------------------------------------------------------------------
// Commands

#[tauri::command]
pub async fn optimize_state(app: AppHandle) -> Overview {
    overview(&app)
}

#[tauri::command]
pub async fn optimize_apply(app: AppHandle, profile: Option<String>, changes: Vec<Change>, close: Vec<String>, free_ram: bool) -> ApplyReport {
    apply(&app, profile, changes, close, free_ram)
}

#[tauri::command]
pub async fn optimize_restore(app: AppHandle) -> ApplyReport {
    restore(&app)
}

#[tauri::command]
pub async fn optimize_free_ram(deep: bool) -> RamReport {
    free_ram(deep)
}

#[tauri::command]
pub async fn optimize_analyze(app: AppHandle) -> Vec<Rec> {
    analyze(&app)
}

#[tauri::command]
pub async fn startup_apps() -> Vec<StartupEntry> {
    startup_list()
}

#[tauri::command]
pub async fn startup_set(scope: String, name: String, enabled: bool, admin: bool) -> Result<(), String> {
    if admin {
        match elevate::run(vec![elevate::Task::Startup { scope, name, enabled }])?.pop() {
            Some(elevate::Outcome::Done(r)) => r,
            _ => Err("no result".into()),
        }
    } else {
        startup_write(&scope, &name, enabled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Read-only look at this machine: `cargo test --lib live_read -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_read() {
        for (id, _, _) in TWEAKS {
            println!("{id}: {:?}", read(id));
        }
        println!("plan: {:?}", active_plan());
        for s in startup_list() {
            println!("startup [{}] {} {} -> {}", s.scope, if s.enabled { "on " } else { "off" }, s.name, s.path);
        }
        let t0 = std::time::Instant::now();
        let scan = crate::cleanup::scan();
        println!("scan took {:?}", t0.elapsed());
        for c in scan.iter().filter(|c| c.present) {
            println!("clean {:<16} {:>8.1} MB {:>6} files partial={} running={:?}", c.id, c.size as f64 / 1048576.0, c.files, c.partial, c.running);
        }
    }

    #[test]
    fn finds_guids() {
        let out = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)";
        assert_eq!(find_guid(out).as_deref(), Some(GUID_BALANCED));
        assert_eq!(find_guid("nothing here"), None);
    }

    #[test]
    fn kv_strings() {
        assert_eq!(kv_set("", "SwapEffectUpgradeEnable", "1"), "SwapEffectUpgradeEnable=1;");
        let s = kv_set("VRROptimizeEnable=0;SwapEffectUpgradeEnable=0;", "SwapEffectUpgradeEnable", "1");
        assert_eq!(s, "VRROptimizeEnable=0;SwapEffectUpgradeEnable=1;");
        assert_eq!(kv_get(&s, "SwapEffectUpgradeEnable").as_deref(), Some("1"));
    }

    #[test]
    fn program_paths() {
        assert_eq!(program_of(r#""C:\Program Files\App\app.exe" --min"#), r"C:\Program Files\App\app.exe");
        assert_eq!(program_of(r"C:\Tools\x.EXE /s"), r"C:\Tools\x.EXE");
    }

    #[test]
    fn plan_names_match() {
        let st = OptState { ultimate: Some("11111111-2222-3333-4444-555555555555".into()), ..Default::default() };
        assert!(plan_matches(Some(&json!(GUID_HIGH)), &json!("high"), &st));
        assert!(plan_matches(Some(&json!("11111111-2222-3333-4444-555555555555")), &json!("ultimate"), &st));
        assert!(!plan_matches(Some(&json!(GUID_BALANCED)), &json!("high"), &st));
    }
}
