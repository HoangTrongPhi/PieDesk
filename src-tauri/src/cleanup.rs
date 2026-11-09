//! CleanUp utility (Manager → Utilities → Clean up): junk categories with their size, cleaning,
//! drive usage, a large-file finder.
//!
//! Every category is a list of path patterns (`%VAR%` expanded, a `*` inside one path segment
//! matches entries). A pattern that names a folder is emptied (the folder itself stays), one that
//! names a file is deleted. Links and junctions are removed, never followed. Files that are in use
//! are skipped and counted. Categories marked `admin` run in the elevated helper (`elevate.rs`).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::elevate;

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Group {
    System,
    Browser,
    Apps,
    Dev,
    Advanced,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Special {
    RecycleBin,
    Dns,
    Hibernate,
    WindowsUpdate,
    ComponentStore,
}

struct Def {
    id: &'static str,
    group: Group,
    admin: bool,
    default_on: bool,
    /// Cleaning has a cost the user should know about (shaders rebuild, downloads again…).
    caution: bool,
    paths: Vec<String>,
    /// Files changed more recently than this are kept (an installer may still be using them).
    min_age_h: u64,
    special: Option<Special>,
    /// Running programs that lock these files: shown as a hint ("close Chrome to clean it all").
    processes: &'static [&'static str],
}

fn def(id: &'static str, group: Group, paths: &[&str]) -> Def {
    Def {
        id,
        group,
        admin: false,
        default_on: true,
        caution: false,
        paths: paths.iter().map(|p| p.to_string()).collect(),
        min_age_h: 0,
        special: None,
        processes: &[],
    }
}

impl Def {
    fn admin(mut self) -> Self {
        self.admin = true;
        self
    }
    fn caution(mut self) -> Self {
        self.caution = true;
        self.default_on = false;
        self
    }
    fn off(mut self) -> Self {
        self.default_on = false;
        self
    }
    fn age(mut self, hours: u64) -> Self {
        self.min_age_h = hours;
        self
    }
    fn special(mut self, s: Special) -> Self {
        self.special = Some(s);
        self
    }
    fn procs(mut self, p: &'static [&'static str]) -> Self {
        self.processes = p;
        self
    }
}

/// Cache folders of a Chromium browser / Electron app, for every profile.
fn chromium(base: &str) -> Vec<String> {
    let mut out = Vec::new();
    for profile in ["Default", "Profile *", "Guest Profile"] {
        for sub in ["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache"] {
            out.push(format!(r"{base}\{profile}\{sub}"));
        }
    }
    for sub in ["ShaderCache", "GrShaderCache", "GraphiteDawnCache"] {
        out.push(format!(r"{base}\{sub}"));
    }
    out
}

fn electron(base: &str) -> Vec<String> {
    ["Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache"].iter().map(|s| format!(r"{base}\{s}")).collect()
}

fn browser(id: &'static str, paths: Vec<String>, procs: &'static [&'static str]) -> Def {
    Def { paths, ..def(id, Group::Browser, &[]) }.procs(procs)
}

fn catalog() -> Vec<Def> {
    use Group::*;
    vec![
        // --- Windows
        def("user_temp", System, &["%TEMP%"]).age(1),
        def("win_temp", System, &[r"%WINDIR%\Temp"]).age(1).admin(),
        def("recycle_bin", System, &[]).special(Special::RecycleBin),
        def("thumbnails", System, &[
            r"%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db",
            r"%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db",
        ]),
        def("crash_user", System, &[
            r"%LOCALAPPDATA%\CrashDumps",
            r"%LOCALAPPDATA%\Microsoft\Windows\WER\ReportArchive",
            r"%LOCALAPPDATA%\Microsoft\Windows\WER\ReportQueue",
        ]),
        def("crash_system", System, &[
            r"%WINDIR%\Minidump",
            r"%WINDIR%\MEMORY.DMP",
            r"%WINDIR%\LiveKernelReports",
            r"%PROGRAMDATA%\Microsoft\Windows\WER\ReportArchive",
            r"%PROGRAMDATA%\Microsoft\Windows\WER\ReportQueue",
        ]).admin(),
        def("wu_cache", System, &[r"%WINDIR%\SoftwareDistribution\Download"]).admin().special(Special::WindowsUpdate),
        def("delivery_opt", System, &[
            r"%WINDIR%\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache",
        ]).admin(),
        def("win_logs", System, &[r"%WINDIR%\Logs", r"%WINDIR%\System32\LogFiles", r"%WINDIR%\Panther"]).admin().age(24 * 7),
        def("dns", System, &[]).special(Special::Dns),
        def("shader_cache", System, &[
            r"%LOCALAPPDATA%\D3DSCache",
            r"%LOCALAPPDATA%\NVIDIA\DXCache",
            r"%LOCALAPPDATA%\NVIDIA\GLCache",
            r"%LOCALAPPDATA%\AMD\DxCache",
            r"%LOCALAPPDATA%\AMD\DxcCache",
            r"%LOCALAPPDATA%\AMD\GLCache",
            r"%LOCALAPPDATA%\AMD\VkCache",
            r"%LOCALAPPDATA%\Intel\ShaderCache",
        ]).caution(),
        // --- Browsers (cache only: logins, cookies and history stay)
        browser("chrome", chromium(r"%LOCALAPPDATA%\Google\Chrome\User Data"), &["chrome.exe"]),
        browser("edge", chromium(r"%LOCALAPPDATA%\Microsoft\Edge\User Data"), &["msedge.exe"]),
        browser("brave", chromium(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data"), &["brave.exe"]),
        browser("vivaldi", chromium(r"%LOCALAPPDATA%\Vivaldi\User Data"), &["vivaldi.exe"]),
        browser("opera", vec![
            r"%LOCALAPPDATA%\Opera Software\Opera Stable\Cache".into(),
            r"%LOCALAPPDATA%\Opera Software\Opera GX Stable\Cache".into(),
            r"%APPDATA%\Opera Software\Opera Stable\GPUCache".into(),
            r"%APPDATA%\Opera Software\Opera GX Stable\GPUCache".into(),
        ], &["opera.exe"]),
        browser("firefox", vec![
            r"%LOCALAPPDATA%\Mozilla\Firefox\Profiles\*\cache2".into(),
            r"%LOCALAPPDATA%\Mozilla\Firefox\Profiles\*\startupCache".into(),
            r"%LOCALAPPDATA%\Mozilla\Firefox\Profiles\*\thumbnails".into(),
        ], &["firefox.exe"]),
        // --- Apps & games
        Def { paths: electron(r"%APPDATA%\discord"), ..def("discord", Apps, &[]) }.procs(&["Discord.exe"]),
        Def {
            paths: [electron(r"%APPDATA%\Microsoft\Teams"),
                electron(r"%LOCALAPPDATA%\Packages\MSTeams_8wekyb3d8bbwe\LocalCache\Microsoft\MSTeams\EBWebView\WV2Profile_tfw")].concat(),
            ..def("teams", Apps, &[])
        }.procs(&["ms-teams.exe", "Teams.exe"]),
        Def {
            paths: [electron(r"%APPDATA%\Code"), electron(r"%APPDATA%\Cursor"),
                vec![r"%APPDATA%\Code\CachedData".into(), r"%APPDATA%\Cursor\CachedData".into(), r"%APPDATA%\Code\logs".into(), r"%APPDATA%\Cursor\logs".into()]].concat(),
            ..def("vscode", Apps, &[])
        }.procs(&["Code.exe", "Cursor.exe"]),
        def("spotify", Apps, &[r"%LOCALAPPDATA%\Spotify\Data", r"%LOCALAPPDATA%\Spotify\Browser\Cache"]).procs(&["Spotify.exe"]),
        def("launchers", Apps, &[
            r"%LOCALAPPDATA%\Steam\htmlcache",
            r"%LOCALAPPDATA%\EpicGamesLauncher\Saved\webcache*",
            r"%LOCALAPPDATA%\EpicGamesLauncher\Saved\Logs",
            r"%LOCALAPPDATA%\Battle.net\Cache",
            r"%PROGRAMDATA%\Battle.net\Agent\Logs",
        ]).procs(&["steam.exe", "EpicGamesLauncher.exe", "Battle.net.exe"]),
        def("unreal_logs", Apps, &[
            r"%LOCALAPPDATA%\UnrealEngine\*\Saved\Logs",
            r"%LOCALAPPDATA%\UnrealEngine\*\Saved\Crashes",
            r"%LOCALAPPDATA%\CrashReportClient\Saved\Logs",
        ]).procs(&["UnrealEditor.exe", "UE4Editor.exe"]),
        def("unreal_ddc", Apps, &[r"%LOCALAPPDATA%\UnrealEngine\Common\DerivedDataCache"]).caution().procs(&["UnrealEditor.exe", "UE4Editor.exe"]),
        def("maya", Apps, &[r"%DOCUMENTS%\maya\*\prefs\tmp"]).procs(&["maya.exe"]),
        def("adobe_media", Apps, &[r"%APPDATA%\Adobe\Common\Media Cache Files", r"%APPDATA%\Adobe\Common\Media Cache"]).caution(),
        // --- Developer caches (downloaded again when needed)
        def("npm", Dev, &[r"%LOCALAPPDATA%\npm-cache\_cacache", r"%LOCALAPPDATA%\Yarn\Cache"]).off(),
        def("pip", Dev, &[r"%LOCALAPPDATA%\pip\cache"]).off(),
        def("cargo", Dev, &[r"%USERPROFILE%\.cargo\registry\cache", r"%USERPROFILE%\.cargo\registry\src"]).off(),
        def("nuget", Dev, &[r"%LOCALAPPDATA%\NuGet\v3-cache", r"%LOCALAPPDATA%\NuGet\plugins-cache"]).off(),
        def("gradle", Dev, &[r"%USERPROFILE%\.gradle\caches"]).off(),
        // --- Advanced
        def("prefetch", Advanced, &[r"%WINDIR%\Prefetch"]).admin().caution(),
        def("hibernate", Advanced, &[]).admin().caution().special(Special::Hibernate),
        def("component_store", Advanced, &[]).admin().caution().special(Special::ComponentStore),
    ]
}

// ---------------------------------------------------------------------------------------------
// Paths

fn documents_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
        if let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Documents, KF_FLAG_DEFAULT, None) {
            let s = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as _));
            if let Some(s) = s {
                return Some(PathBuf::from(s));
            }
        }
    }
    std::env::var_os("USERPROFILE").map(|u| PathBuf::from(u).join("Documents"))
}

/// Replaces `%NAME%` with the environment variable (or a known folder). None when one is missing.
fn expand_vars(pattern: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = pattern;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find('%')?;
        let name = &after[..end];
        let value = match name {
            "DOCUMENTS" => documents_dir()?.to_string_lossy().into_owned(),
            "WINDIR" => std::env::var("WINDIR").or_else(|_| std::env::var("SystemRoot")).ok()?,
            _ => std::env::var(name).ok()?,
        };
        out.push_str(&value);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// `*` matches any run of characters, case-insensitively.
fn wildcard(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let n: Vec<char> = name.to_lowercase().chars().collect();
    let (mut pi, mut ni, mut star, mut mark) = (0, 0, None, 0);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == n[ni] || p[pi] == '?') {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ni;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ni = mark;
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|c| *c == '*')
}

/// Existing paths matching a pattern (after variable expansion).
fn expand(pattern: &str) -> Vec<PathBuf> {
    let Some(full) = expand_vars(pattern) else { return Vec::new() };
    let mut parts = full.split('\\').filter(|s| !s.is_empty());
    let Some(first) = parts.next() else { return Vec::new() };
    let mut current = vec![PathBuf::from(format!("{first}\\"))];
    for seg in parts {
        let mut next = Vec::new();
        for base in &current {
            if seg.contains('*') {
                if let Ok(rd) = fs::read_dir(base) {
                    for e in rd.flatten() {
                        if wildcard(seg, &e.file_name().to_string_lossy()) {
                            next.push(e.path());
                        }
                    }
                }
            } else {
                let p = base.join(seg);
                if fs::symlink_metadata(&p).is_ok() {
                    next.push(p);
                }
            }
        }
        current = next;
        if current.is_empty() {
            break;
        }
    }
    current
}

fn targets(d: &Def) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    d.paths.iter().flat_map(|p| expand(p)).filter(|p| seen.insert(p.to_string_lossy().to_lowercase())).collect()
}

fn old_enough(meta: &fs::Metadata, min_age: Duration) -> bool {
    if min_age.is_zero() {
        return true;
    }
    let newest = [meta.modified().ok(), meta.created().ok()].into_iter().flatten().max();
    newest.and_then(|t| SystemTime::now().duration_since(t).ok()).map_or(true, |age| age >= min_age)
}

#[derive(Default, Clone, Copy)]
struct Tally {
    bytes: u64,
    files: u64,
    denied: bool,
}

/// Size of what cleaning would remove.
fn measure(path: &Path, min_age: Duration, t: &mut Tally) {
    let Ok(meta) = fs::symlink_metadata(path) else { return };
    if meta.is_file() {
        if old_enough(&meta, min_age) {
            t.bytes += meta.len();
            t.files += 1;
        }
        return;
    }
    if meta.file_type().is_symlink() {
        return;
    }
    match fs::read_dir(path) {
        Ok(rd) => {
            for e in rd.flatten() {
                measure(&e.path(), min_age, t);
            }
        }
        Err(_) => t.denied = true,
    }
}

#[derive(Default, Clone, Copy)]
struct Removed {
    bytes: u64,
    files: u64,
    skipped: u64,
}

fn remove_file(path: &Path) -> bool {
    if fs::remove_file(path).is_ok() {
        return true;
    }
    // Read-only files refuse deletion on Windows.
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            #[allow(clippy::permissions_set_readonly_false)]
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
            return fs::remove_file(path).is_ok();
        }
    }
    false
}

/// Deletes the contents of a folder (or the file itself). Returns whether `path` became empty.
fn clear(path: &Path, min_age: Duration, keep_root: bool, r: &mut Removed) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else { return true };
    if meta.file_type().is_symlink() {
        // Remove the link only, never what it points at.
        return fs::remove_dir(path).or_else(|_| fs::remove_file(path)).is_ok();
    }
    if meta.is_file() {
        if !old_enough(&meta, min_age) {
            return false;
        }
        if remove_file(path) {
            r.bytes += meta.len();
            r.files += 1;
            return true;
        }
        r.skipped += 1;
        return false;
    }
    let Ok(rd) = fs::read_dir(path) else {
        r.skipped += 1;
        return false;
    };
    let mut empty = true;
    for e in rd.flatten() {
        empty &= clear(&e.path(), min_age, false, r);
    }
    if empty && !keep_root {
        return fs::remove_dir(path).is_ok();
    }
    empty
}

// ---------------------------------------------------------------------------------------------
// Specials

#[cfg(windows)]
fn recycle_bin_size() -> (u64, u64) {
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    match unsafe { SHQueryRecycleBinW(None, &mut info) } {
        Ok(()) => (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64),
        Err(_) => (0, 0),
    }
}
#[cfg(not(windows))]
fn recycle_bin_size() -> (u64, u64) {
    (0, 0)
}

fn system_drive() -> String {
    std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into())
}

fn hiberfil_size() -> u64 {
    // hiberfil.sys can't be opened, but listing its folder shows its size.
    let root = format!("{}\\", system_drive());
    fs::read_dir(&root)
        .ok()
        .and_then(|rd| rd.flatten().find(|e| e.file_name().eq_ignore_ascii_case("hiberfil.sys")))
        .and_then(|e| e.metadata().ok())
        .map_or(0, |m| m.len())
}

/// Free bytes on a drive (`C:`).
pub fn free_space(drive: &str) -> u64 {
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut free = 0u64;
        if GetDiskFreeSpaceExW(&HSTRING::from(format!("{drive}\\")), Some(&mut free), None, None).is_ok() {
            return free;
        }
    }
    let _ = drive;
    0
}

/// Runs a console tool without a window.
pub fn run_hidden(exe: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = std::process::Command::new(exe);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("{exe}: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        Ok(text)
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(format!("{exe} {}: {}", args.join(" "), if err.trim().is_empty() { text.trim() } else { err.trim() }))
    }
}

// ---------------------------------------------------------------------------------------------
// Scan

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: &'static str,
    pub group: Group,
    pub admin: bool,
    pub default_on: bool,
    pub caution: bool,
    /// Bytes cleaning would free (an estimate for specials).
    pub size: u64,
    pub files: u64,
    /// Something to clean exists.
    pub present: bool,
    /// Some folders could not be read without admin rights: the size is a lower bound.
    pub partial: bool,
    /// The size can only be known after cleaning (component store).
    pub unknown: bool,
    /// Programs using these files right now.
    pub running: Vec<String>,
}

fn running_names() -> HashSet<String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let Ok(mut sys) = System::new() else { return Default::default() };
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().values().map(|p| p.name().to_string_lossy().to_lowercase()).collect()
}

pub fn scan() -> Vec<Category> {
    let running = running_names();
    // Categories are measured side by side: walking caches is I/O bound.
    std::thread::scope(|s| {
        let running = &running;
        let jobs: Vec<_> = catalog().into_iter().map(|d| s.spawn(move || scan_one(d, running))).collect();
        jobs.into_iter().filter_map(|j| j.join().ok()).collect()
    })
}

fn scan_one(d: Def, running: &HashSet<String>) -> Category {
    {
        {
            let mut t = Tally::default();
            let mut unknown = false;
            let mut present;
            match d.special {
                Some(Special::RecycleBin) => {
                    (t.bytes, t.files) = recycle_bin_size();
                    present = t.files > 0;
                }
                Some(Special::Dns) => present = true,
                Some(Special::Hibernate) => {
                    t.bytes = hiberfil_size();
                    present = t.bytes > 0;
                }
                Some(Special::ComponentStore) => {
                    unknown = true;
                    present = true;
                }
                _ => {
                    let min_age = Duration::from_secs(d.min_age_h * 3600);
                    let found = targets(&d);
                    for p in &found {
                        measure(p, min_age, &mut t);
                    }
                    present = !found.is_empty();
                    if d.special == Some(Special::WindowsUpdate) {
                        present = t.bytes > 0 || t.denied;
                    }
                }
            }
            if d.special.is_none() && t.bytes == 0 && !t.denied {
                present = false;
            }
            Category {
                id: d.id,
                group: d.group,
                admin: d.admin,
                default_on: d.default_on,
                caution: d.caution,
                size: t.bytes,
                files: t.files,
                present,
                partial: t.denied,
                unknown,
                running: d.processes.iter().filter(|p| running.contains(&p.to_lowercase())).map(|p| p.to_string()).collect(),
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Clean

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub id: String,
    pub freed: u64,
    pub files: u64,
    /// Files that were in use or protected.
    pub skipped: u64,
    pub error: Option<String>,
}

/// Cleans categories in this process (the caller decides about admin rights).
pub fn clean_here(ids: &[String]) -> Vec<CleanResult> {
    let defs = catalog();
    ids.iter()
        .filter_map(|id| defs.iter().find(|d| d.id == id))
        .map(|d| {
            let mut res = CleanResult { id: d.id.into(), ..Default::default() };
            match d.special {
                Some(Special::RecycleBin) => {
                    let (size, n) = recycle_bin_size();
                    #[cfg(windows)]
                    unsafe {
                        use windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
                        if n > 0 {
                            if let Err(e) = SHEmptyRecycleBinW(None, None, SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND) {
                                res.error = Some(e.message());
                            }
                        }
                    }
                    if res.error.is_none() {
                        (res.freed, res.files) = (size, n);
                    }
                }
                Some(Special::Dns) => res.error = run_hidden("ipconfig", &["/flushdns"]).err(),
                Some(Special::Hibernate) => {
                    let size = hiberfil_size();
                    match run_hidden("powercfg", &["/hibernate", "off"]) {
                        Ok(_) => res.freed = size,
                        Err(e) => res.error = Some(e),
                    }
                }
                Some(Special::ComponentStore) => {
                    let drive = system_drive();
                    let before = free_space(&drive);
                    match run_hidden("Dism.exe", &["/Online", "/Cleanup-Image", "/StartComponentCleanup", "/NoRestart"]) {
                        Ok(_) => res.freed = free_space(&drive).saturating_sub(before),
                        Err(e) => res.error = Some(e),
                    }
                }
                special => {
                    let stopped = if special == Some(Special::WindowsUpdate) {
                        ["wuauserv", "bits"].into_iter().filter(|s| crate::optimize::service_set(s, false).unwrap_or(false)).collect()
                    } else {
                        Vec::new()
                    };
                    let min_age = Duration::from_secs(d.min_age_h * 3600);
                    let mut r = Removed::default();
                    for p in targets(d) {
                        let is_dir = fs::symlink_metadata(&p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false);
                        clear(&p, min_age, is_dir, &mut r);
                    }
                    for s in stopped {
                        let _ = crate::optimize::service_set(s, true);
                    }
                    (res.freed, res.files, res.skipped) = (r.bytes, r.files, r.skipped);
                }
            }
            res
        })
        .collect()
}

/// Cleans the picked categories; the admin ones go to the elevated helper in one UAC prompt.
pub fn clean(ids: &[String]) -> Vec<CleanResult> {
    let defs = catalog();
    let is_admin = |id: &String| defs.iter().any(|d| d.id == id && d.admin);
    let (admin, user): (Vec<String>, Vec<String>) = ids.iter().cloned().partition(is_admin);
    let mut out = clean_here(&user);
    if !admin.is_empty() {
        match elevate::run(vec![elevate::Task::Clean { ids: admin.clone() }]) {
            Ok(results) => {
                for r in results {
                    if let elevate::Outcome::Clean(list) = r {
                        out.extend(list);
                    }
                }
            }
            Err(e) => out.extend(admin.into_iter().map(|id| CleanResult { id, error: Some(e.clone()), ..Default::default() })),
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Drives & large files

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub mount: String,
    pub name: String,
    pub total: u64,
    pub free: u64,
    pub system: bool,
}

pub fn drives() -> Vec<Drive> {
    let sys = system_drive().to_uppercase();
    let Ok(disks) = sysinfo::Disks::new_with_refreshed_list() else { return Vec::new() };
    let mut seen = HashSet::new();
    disks
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| {
            let mount = d.mount_point().to_string_lossy().trim_end_matches('\\').to_string();
            Drive {
                system: mount.to_uppercase() == sys,
                name: d.name().to_string_lossy().into_owned(),
                total: d.total_space(),
                free: d.available_space(),
                mount,
            }
        })
        .filter(|d| seen.insert(d.mount.clone()))
        .collect()
}

#[derive(Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct BigFile {
    pub size: u64,
    pub path: String,
    /// Last change, ms since the epoch.
    pub modified: u64,
}

/// The `limit` biggest files under `root` of at least `min_bytes` (Windows' own folder and
/// paging / hibernation files are left out: they are not the user's to delete).
pub fn large_files(root: &str, min_bytes: u64, limit: usize) -> Vec<BigFile> {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;
    let windir = std::env::var("WINDIR").unwrap_or_default().to_lowercase();
    let skip_names = ["pagefile.sys", "hiberfil.sys", "swapfile.sys", "dumpstack.log.tmp"];
    let mut heap: BinaryHeap<Reverse<BigFile>> = BinaryHeap::new();
    let mut stack = vec![PathBuf::from(root)];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            let path = e.path();
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                let lower = path.to_string_lossy().to_lowercase();
                if lower != windir && !lower.ends_with("\\$recycle.bin") && !lower.ends_with("\\system volume information") {
                    stack.push(path);
                }
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            if meta.len() < min_bytes || skip_names.iter().any(|n| e.file_name().eq_ignore_ascii_case(n)) {
                continue;
            }
            let modified = meta.modified().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
            heap.push(Reverse(BigFile { size: meta.len(), path: path.to_string_lossy().into_owned(), modified }));
            if heap.len() > limit {
                heap.pop();
            }
        }
    }
    let mut out: Vec<BigFile> = heap.into_iter().map(|Reverse(f)| f).collect();
    out.sort_by(|a, b| b.size.cmp(&a.size));
    out
}

/// Moves files to the Recycle Bin (undoable, unlike the junk categories).
pub fn recycle(paths: &[String]) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE, SHFILEOPSTRUCTW};
        if paths.is_empty() {
            return Ok(());
        }
        // Double-NUL-terminated list.
        let mut from: Vec<u16> = Vec::new();
        for p in paths {
            from.extend(p.encode_utf16());
            from.push(0);
        }
        from.push(0);
        let mut op = SHFILEOPSTRUCTW {
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT).0 as u16,
            ..Default::default()
        };
        let code = SHFileOperationW(&mut op);
        if code != 0 {
            return Err(format!("SHFileOperation 0x{code:x}"));
        }
        if op.fAnyOperationsAborted.as_bool() {
            return Err("aborted".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = paths;
        Err("unsupported".into())
    }
}

// ---------------------------------------------------------------------------------------------
// Commands

#[tauri::command]
pub async fn cleanup_scan() -> Vec<Category> {
    scan()
}

#[tauri::command]
pub async fn cleanup_clean(ids: Vec<String>) -> Vec<CleanResult> {
    clean(&ids)
}

#[tauri::command]
pub async fn cleanup_drives() -> Vec<Drive> {
    drives()
}

#[tauri::command]
pub async fn cleanup_large(root: String, min_mb: u64) -> Vec<BigFile> {
    large_files(&root, min_mb * 1024 * 1024, 300)
}

#[tauri::command]
pub async fn cleanup_recycle(paths: Vec<String>) -> Result<(), String> {
    recycle(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn live_expand() {
        for d in catalog().iter().take(4) {
            let t0 = std::time::Instant::now();
            println!("{} {:?} -> {:?}", d.id, d.paths.first().map(|p| expand_vars(p)), targets(d));
            let mut t = Tally::default();
            for p in targets(d) { measure(&p, Duration::ZERO, &mut t); }
            println!("  {} bytes {} files denied={} in {:?}", t.bytes, t.files, t.denied, t0.elapsed());
        }
    }

    #[test]
    fn wildcard_matches() {
        assert!(wildcard("Profile *", "Profile 12"));
        assert!(!wildcard("Profile *", "Default"));
        assert!(wildcard("thumbcache_*.db", "thumbcache_1024.db"));
        assert!(!wildcard("thumbcache_*.db", "thumbcache_1024.dbx"));
        assert!(wildcard("webcache*", "webcache_4430"));
    }

    #[test]
    fn ids_are_unique() {
        let ids: HashSet<_> = catalog().iter().map(|d| d.id).collect();
        assert_eq!(ids.len(), catalog().len());
    }

    #[test]
    fn clears_contents_keeps_root_and_young_files() {
        let root = std::env::temp_dir().join(format!("piedesk-clean-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("x.tmp"), vec![0u8; 100]).unwrap();
        fs::write(root.join("a/b/y.tmp"), vec![0u8; 50]).unwrap();
        let mut t = Tally::default();
        measure(&root, Duration::ZERO, &mut t);
        assert_eq!((t.bytes, t.files), (150, 2));
        // Files younger than an hour stay.
        let mut r = Removed::default();
        clear(&root, Duration::from_secs(3600), true, &mut r);
        assert_eq!(r.files, 0);
        assert!(root.join("x.tmp").exists());
        let mut r = Removed::default();
        assert!(clear(&root, Duration::ZERO, true, &mut r));
        assert_eq!((r.bytes, r.files), (150, 2));
        assert!(root.exists() && fs::read_dir(&root).unwrap().next().is_none());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn expands_patterns() {
        let root = std::env::temp_dir().join(format!("piedesk-expand-{}", std::process::id()));
        fs::create_dir_all(root.join("Profile 1/Cache")).unwrap();
        fs::create_dir_all(root.join("Profile 2")).unwrap();
        fs::create_dir_all(root.join("Default/Cache")).unwrap();
        let found = expand(&format!(r"{}\Profile *\Cache", root.display()));
        assert_eq!(found.len(), 1);
        fs::remove_dir_all(&root).unwrap();
    }
}
