//! Utilities → Uninstaller: installed programs, their own uninstaller, then what it left behind.
//!
//! Programs come from the three Uninstall keys Windows' own "Installed apps" reads (HKLM 64-bit,
//! HKLM 32-bit and HKCU). Uninstalling runs the program's own uninstaller (or `msiexec /x`), so
//! nothing is torn out by force. Afterwards a leftover scan looks for folders and registry keys
//! that still carry the program's name: only exact name matches in the usual places, never
//! anything under Windows or Microsoft. Folders go to the Recycle Bin and registry keys are
//! exported to a `.reg` backup before they are deleted, so a removal can be undone.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    /// `<hive>|<view>|<subkey name>`: where the entry lives.
    pub key: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    /// `YYYY-MM-DD` or empty.
    pub installed: String,
    /// Bytes, 0 when the program does not say.
    pub size: u64,
    pub location: String,
    pub icon: String,
    pub uninstall: String,
    pub quiet: String,
    /// Installed for every user: removing it needs admin rights.
    pub machine: bool,
    pub msi: bool,
    /// Windows Installer cannot uninstall it as is: its cached package is gone, or only its
    /// registration is left (no entry in Installed apps).
    pub broken: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Leftover {
    /// "folder" | "file" | "registry"
    pub kind: String,
    pub path: String,
    pub size: u64,
    pub admin: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StoreApp {
    pub name: String,
    pub full_name: String,
    pub publisher: String,
    pub version: String,
    pub location: String,
}

// ---------------------------------------------------------------------------------------------
// Names

/// Lowercase letters, digits and + / # only: "Notepad++ (64-bit)" → "notepad++64bit".
fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric() || *c == '+' || *c == '#').flat_map(char::to_lowercase).collect()
}

/// The program name without the version / architecture tail most installers append.
fn base_name(name: &str) -> String {
    let mut words: Vec<&str> = name.split_whitespace().collect();
    while let Some(last) = words.last() {
        let l = last.trim_matches(|c: char| c == '(' || c == ')' || c == '-' || c == ',').to_lowercase();
        let versiony = l.starts_with('v') && l[1..].chars().next().is_some_and(|c| c.is_ascii_digit())
            || l.chars().next().is_some_and(|c| c.is_ascii_digit());
        let arch = matches!(l.as_str(), "x64" | "x86" | "64-bit" | "32-bit" | "64bit" | "32bit" | "amd64" | "arm64" | "64" | "32" | "bit" | "");
        if words.len() > 1 && (versiony || arch) {
            words.pop();
        } else {
            break;
        }
    }
    words.join(" ")
}

fn publisher_name(p: &str) -> String {
    let mut s = norm(p);
    for tail in ["incorporated", "corporation", "limited", "company", "software", "inc", "corp", "ltd", "llc", "gmbh", "co"] {
        if s.len() > tail.len() + 2 && s.ends_with(tail) {
            s.truncate(s.len() - tail.len());
            break;
        }
    }
    s
}

/// Names that must never be offered for removal, however a program calls itself.
const PROTECTED: [&str; 44] = [
    "microsoft", "windows", "windowsapps", "commonfiles", "internetexplorer", "windowsdefender", "windowsnt",
    "packages", "temp", "programs", "system32", "syswow64", "drivers", "nvidia", "nvidiacorporation", "intel",
    "amd", "google", "classes", "policies", "wow6432node", "clients", "microsoftnet", "dotnet",
    // Generic folder names an install location often ends in.
    "application", "app", "apps", "bin", "program", "current", "x64", "x86", "launcher", "data", "common",
    "shared", "tools", "update", "client", "runtime", "steam", "steamapps", "games", "plugins",
];

/// What a folder or key must be called to count as the program's: its full name, its name
/// without the version, or the name of the folder it was installed in.
fn tokens(p: &Program) -> Vec<String> {
    let mut t = vec![norm(&p.name), norm(&base_name(&p.name))];
    if let Some(dir) = Path::new(&p.location).file_name() {
        t.push(norm(&dir.to_string_lossy()));
    }
    // A program called after its publisher ("Epic Games Launcher" in "...\Epic Games") must not
    // take the publisher's shared folders with it.
    let publisher = publisher_name(&p.publisher);
    t.retain(|x| x.len() >= 4 && !PROTECTED.contains(&x.as_str()) && *x != publisher && *x != norm(&p.publisher));
    t.sort();
    t.dedup();
    t
}

fn matches(tokens: &[String], name: &str) -> bool {
    let n = norm(name);
    !n.is_empty() && tokens.iter().any(|t| *t == n)
}

fn parse_date(s: &str) -> String {
    let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if d.len() == 8 { format!("{}-{}-{}", &d[0..4], &d[4..6], &d[6..8]) } else { String::new() }
}

/// `"C:\x\app.exe",0` → `C:\x\app.exe`.
fn icon_path(s: &str) -> String {
    let s = s.trim();
    let s = match s.rfind(',') {
        Some(i) if s[i + 1..].trim().trim_start_matches('-').chars().all(|c| c.is_ascii_digit()) => &s[..i],
        _ => s,
    };
    s.trim().trim_matches('"').to_string()
}

/// Splits an uninstall command into program and arguments; unquoted paths with spaces are common.
fn split_command(cmd: &str) -> (String, String) {
    let cmd = cmd.trim();
    if let Some(rest) = cmd.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            return (rest[..end].to_string(), rest[end + 1..].trim().to_string());
        }
    }
    let lower = cmd.to_lowercase();
    if let Some(i) = lower.find(".exe") {
        let end = i + 4;
        return (cmd[..end].to_string(), cmd[end..].trim().to_string());
    }
    match cmd.split_once(' ') {
        Some((a, b)) => (a.to_string(), b.trim().to_string()),
        None => (cmd.to_string(), String::new()),
    }
}

fn msi_code(p: &Program) -> Option<String> {
    let k = p.key.rsplit('|').next()?;
    (k.starts_with('{') && k.ends_with('}')).then(|| k.to_string())
}

fn dir_size(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    if meta.file_type().is_symlink() {
        return 0;
    }
    std::fs::read_dir(path).map(|rd| rd.flatten().map(|e| dir_size(&e.path())).sum()).unwrap_or(0)
}

// ---------------------------------------------------------------------------------------------
// Registry (Windows)

#[cfg(windows)]
mod reg {
    use winreg::enums::*;
    use winreg::RegKey;

    pub const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    /// (hive, view) pairs Windows lists programs from.
    pub const VIEWS: [(&str, &str); 3] = [("HKLM", "64"), ("HKLM", "32"), ("HKCU", "64")];

    pub fn flags(view: &str) -> u32 {
        if view == "32" { KEY_WOW64_32KEY } else { KEY_WOW64_64KEY }
    }

    pub fn root(hive: &str) -> RegKey {
        RegKey::predef(if hive == "HKLM" { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER })
    }

    pub fn open(hive: &str, view: &str, path: &str) -> Option<RegKey> {
        root(hive).open_subkey_with_flags(path, KEY_READ | flags(view)).ok()
    }

    pub fn s(k: &RegKey, name: &str) -> String {
        k.get_value::<String, _>(name).unwrap_or_default()
    }

    pub fn n(k: &RegKey, name: &str) -> u32 {
        k.get_value::<u32, _>(name).unwrap_or(0)
    }

    /// The path `reg.exe` understands for a key in a view.
    pub fn reg_path(hive: &str, view: &str, path: &str) -> String {
        if hive == "HKLM" && view == "32" {
            // reg.exe sees the 32-bit view through WOW6432Node.
            let rest = path.strip_prefix("Software\\").unwrap_or(path);
            format!(r"HKLM\Software\WOW6432Node\{rest}")
        } else {
            format!(r"{hive}\{path}")
        }
    }
}

#[cfg(windows)]
pub fn list() -> Vec<Program> {
    use std::collections::HashSet;
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for (hive, view) in reg::VIEWS {
        let Some(root) = reg::open(hive, view, reg::UNINSTALL) else { continue };
        for sub in root.enum_keys().flatten() {
            let Some(k) = reg::open(hive, view, &format!(r"{}\{sub}", reg::UNINSTALL)) else { continue };
            let name = reg::s(&k, "DisplayName");
            let uninstall = reg::s(&k, "UninstallString");
            if name.trim().is_empty() || uninstall.trim().is_empty() {
                continue;
            }
            // Same filters as Windows' own list: hidden components, patches and updates.
            if reg::n(&k, "SystemComponent") == 1 || !reg::s(&k, "ParentKeyName").is_empty() {
                continue;
            }
            let release = reg::s(&k, "ReleaseType").to_lowercase();
            if release.contains("update") || release.contains("hotfix") || release.contains("patch") {
                continue;
            }
            // The 64-bit and 32-bit views are the same key on 32-bit Windows.
            if !seen.insert((hive, sub.to_lowercase(), name.to_lowercase())) {
                continue;
            }
            let location = reg::s(&k, "InstallLocation").trim().trim_matches('"').trim_end_matches('\\').to_string();
            let mut icon = icon_path(&reg::s(&k, "DisplayIcon"));
            if icon.is_empty() || !Path::new(&icon).exists() {
                let (exe, _) = split_command(&uninstall);
                icon = if Path::new(&exe).exists() && !exe.to_lowercase().ends_with("msiexec.exe") { exe } else { String::new() };
            }
            out.push(Program {
                key: format!("{hive}|{view}|{sub}"),
                publisher: reg::s(&k, "Publisher").trim().to_string(),
                version: reg::s(&k, "DisplayVersion").trim().to_string(),
                installed: parse_date(&reg::s(&k, "InstallDate")),
                size: reg::n(&k, "EstimatedSize") as u64 * 1024,
                icon,
                quiet: reg::s(&k, "QuietUninstallString"),
                machine: hive == "HKLM",
                msi: reg::n(&k, "WindowsInstaller") == 1 || uninstall.to_lowercase().contains("msiexec"),
                broken: false,
                name: name.trim().to_string(),
                uninstall,
                location,
            });
        }
    }
    for p in out.iter_mut().filter(|p| p.msi) {
        if let Some(code) = msi_code(p) {
            p.broken = msi_package_missing(&code);
        }
    }
    out.extend(orphans(&seen));
    out.sort_by_key(|p| p.name.to_lowercase());
    out
}

/// Where Windows Installer keeps a per-machine product's details.
#[cfg(windows)]
const USERDATA: &str = r"Software\Microsoft\Windows\CurrentVersion\Installer\UserData\S-1-5-18\Products";

/// The product's cached package (`C:\Windows\Installer\*.msi`) is gone: uninstalling it asks for
/// the original installer.
#[cfg(windows)]
fn msi_package_missing(code: &str) -> bool {
    let Some(packed) = packed_guid(code) else { return false };
    let Some(k) = reg::open("HKLM", "64", &format!(r"{USERDATA}\{packed}\InstallProperties")) else { return false };
    let local = reg::s(&k, "LocalPackage");
    !local.trim().is_empty() && !Path::new(local.trim()).exists()
}

/// Per-machine Windows Installer products still registered but missing from Installed apps
/// (their entry was removed by a failed uninstall). Listed so they can be removed by force.
#[cfg(windows)]
fn orphans(seen: &std::collections::HashSet<(&str, String, String)>) -> Vec<Program> {
    let listed: std::collections::HashSet<String> = seen.iter().map(|(_, sub, _)| sub.clone()).collect();
    let Some(root) = reg::open("HKLM", "64", USERDATA) else { return Vec::new() };
    let mut out = Vec::new();
    for packed in root.enum_keys().flatten() {
        let Some(code) = unpacked_guid(&packed) else { continue };
        if listed.contains(&code.to_lowercase()) {
            continue;
        }
        // Still registered as installed (a product being removed loses this key first).
        if reg::open("HKLM", "64", &format!(r"Software\Classes\Installer\Products\{packed}")).is_none() {
            continue;
        }
        let Some(k) = reg::open("HKLM", "64", &format!(r"{USERDATA}\{packed}\InstallProperties")) else { continue };
        let name = reg::s(&k, "DisplayName");
        if name.trim().is_empty() || reg::n(&k, "SystemComponent") == 1 {
            continue;
        }
        out.push(Program {
            key: format!("MSI|64|{code}"),
            name: name.trim().to_string(),
            publisher: reg::s(&k, "Publisher").trim().to_string(),
            version: reg::s(&k, "DisplayVersion").trim().to_string(),
            installed: parse_date(&reg::s(&k, "InstallDate")),
            size: reg::n(&k, "EstimatedSize") as u64 * 1024,
            location: reg::s(&k, "InstallLocation").trim().trim_matches('"').trim_end_matches('\\').to_string(),
            icon: String::new(),
            uninstall: format!("MsiExec.exe /X{code}"),
            quiet: String::new(),
            machine: true,
            msi: true,
            broken: true,
        });
    }
    out
}

/// The program's Uninstall entry still exists (its uninstaller has not finished or was cancelled).
#[cfg(windows)]
pub fn present(key: &str) -> bool {
    let mut it = key.splitn(3, '|');
    let (Some(hive), Some(view), Some(sub)) = (it.next(), it.next(), it.next()) else { return false };
    if hive == "MSI" {
        // Only a Windows Installer registration: present while the product is registered.
        return packed_guid(sub).is_some_and(|p| reg::open("HKLM", "64", &format!(r"Software\Classes\Installer\Products\{p}")).is_some());
    }
    reg::open(hive, view, &format!(r"{}\{sub}", reg::UNINSTALL)).is_some()
}

/// What to start: an installer the user picked (`.msi` → `msiexec /x`, `.exe` as is), else the
/// program's own uninstaller (`msiexec /x {code}` for Windows Installer products).
fn command(p: &Program, file: Option<&str>) -> Result<(String, String), String> {
    if let Some(f) = file.map(str::trim).filter(|f| !f.is_empty()) {
        let lower = f.to_lowercase();
        if !Path::new(f).is_file() {
            return Err(format!("not found: {f}"));
        }
        return if lower.ends_with(".msi") {
            Ok(("msiexec.exe".into(), format!("/x \"{f}\"")))
        } else if lower.ends_with(".exe") {
            Ok((f.to_string(), String::new()))
        } else {
            Err("only .msi or .exe".into())
        };
    }
    let (exe, args) = match msi_code(p) {
        Some(code) if p.msi => ("msiexec.exe".to_string(), format!("/x {code}")),
        _ => split_command(&p.uninstall),
    };
    if exe.is_empty() { Err("no uninstaller".into()) } else { Ok((exe, args)) }
}

/// Starts the program's own uninstaller (or `file`) and waits for it to exit. Many uninstallers
/// copy themselves to %TEMP% and return at once, so the caller also watches [`present`].
/// A program installed for all users goes through the admin helper when it is granted, so its
/// uninstaller does not ask UAC again.
pub fn run(p: &Program, file: Option<&str>) -> Result<u32, String> {
    if p.machine {
        let task = crate::elevate::Task::Uninstall { key: p.key.clone(), file: file.map(String::from) };
        if let Some(res) = crate::elevate::run_quiet(vec![task]) {
            return match res?.pop() {
                Some(crate::elevate::Outcome::Code(r)) => r,
                _ => Err("no answer".into()),
            };
        }
    }
    let (exe, args) = command(p, file)?;
    launch(&exe, &args)
}

/// The admin helper's side of [`run`]: only entries under HKLM (only an admin can write those).
pub fn run_machine(key: &str, file: Option<&str>) -> Result<u32, String> {
    // Both live under HKLM, which only an admin can write.
    if !key.starts_with("HKLM|") && !key.starts_with("MSI|") {
        return Err("not a machine-wide program".into());
    }
    let p = find(key)?;
    let (exe, args) = command(&p, file)?;
    launch(&exe, &args)
}

#[cfg(windows)]
fn launch(exe: &str, args: &str) -> Result<u32, String> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file = HSTRING::from(exe);
    let params = HSTRING::from(args);
    let dir = Path::new(exe).parent().filter(|d| d.is_dir()).map(|d| HSTRING::from(d.as_os_str()));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: w!("open"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: if args.is_empty() { PCWSTR::null() } else { PCWSTR(params.as_ptr()) },
        lpDirectory: dir.as_ref().map_or(PCWSTR::null(), |d| PCWSTR(d.as_ptr())),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info).map_err(|e| {
            if e.code() == windows::Win32::Foundation::ERROR_CANCELLED.to_hresult() { "cancelled".to_string() } else { e.message() }
        })?;
        if info.hProcess.is_invalid() {
            return Ok(0);
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 0u32;
        let _ = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        Ok(code)
    }
}

#[cfg(not(windows))]
fn launch(_exe: &str, _args: &str) -> Result<u32, String> {
    Err("unsupported".into())
}

/// The inverse of [`packed_guid`]: `87654321DCBA10FE…` → `{12345678-ABCD-EF01-…}`.
fn unpacked_guid(packed: &str) -> Option<String> {
    let u = packed_guid(&format!("{{{packed}}}"))?;
    Some(format!("{{{}-{}-{}-{}-{}}}", &u[0..8], &u[8..12], &u[12..16], &u[16..20], &u[20..32]))
}

/// `{12345678-ABCD-EF01-2345-6789ABCDEF01}` → `87654321DCBA10FE32547698BADCFE10`: how Windows
/// Installer names a product under `Installer\Products`.
fn packed_guid(code: &str) -> Option<String> {
    let hex: String = code.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 32 || !code.starts_with('{') {
        return None;
    }
    let rev = |s: &str| s.chars().rev().collect::<String>();
    let mut out = rev(&hex[0..8]) + &rev(&hex[8..12]) + &rev(&hex[12..16]);
    for i in (16..32).step_by(2) {
        out += &rev(&hex[i..i + 2]);
    }
    Some(out.to_uppercase())
}

/// Folders, files and registry keys still named after the program.
#[cfg(windows)]
pub fn leftovers(p: &Program, others: &[String], force: bool) -> Vec<Leftover> {
    use std::collections::HashSet;
    // Folders that hold another installed program are never offered (shared publisher folders).
    let others: Vec<String> = others
        .iter()
        .filter(|o| !o.is_empty())
        .map(|o| o.replace('/', "\\").trim_end_matches('\\').to_lowercase())
        .collect();
    let holds_other = |path: &Path| {
        let me = path.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
        others.iter().any(|o| *o == me || o.starts_with(&format!("{me}\\")))
    };
    let toks = tokens(p);
    let publisher = publisher_name(&p.publisher);
    let publisher_ok = publisher.len() >= 3 && !PROTECTED.contains(&publisher.as_str());
    let mut out: Vec<Leftover> = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |l: Leftover, out: &mut Vec<Leftover>| {
        if seen.insert(l.path.to_lowercase()) {
            out.push(l);
        }
    };

    // Folders.
    let env = |v: &str| std::env::var(v).ok().filter(|s| !s.is_empty()).map(PathBuf::from);
    let mut roots: Vec<(PathBuf, bool)> = Vec::new(); // (dir, needs admin)
    for (v, admin) in [("ProgramFiles", true), ("ProgramFiles(x86)", true), ("ProgramW6432", true), ("ProgramData", true), ("APPDATA", false), ("LOCALAPPDATA", false)] {
        if let Some(d) = env(v) {
            roots.push((d, admin));
        }
    }
    if let Some(l) = env("LOCALAPPDATA") {
        roots.push((l.join("Programs"), false));
    }
    if let Some(a) = env("APPDATA") {
        roots.push((a.join(r"Microsoft\Windows\Start Menu\Programs"), false));
    }
    if let Some(d) = env("ProgramData") {
        roots.push((d.join(r"Microsoft\Windows\Start Menu\Programs"), true));
    }
    if let Some(h) = env("USERPROFILE") {
        roots.push((h.join("Documents"), false));
    }
    roots.sort();
    roots.dedup();

    let in_windows = |path: &Path| {
        let s = path.to_string_lossy().to_lowercase();
        let win = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into()).to_lowercase();
        s.starts_with(&win)
    };
    let mut folder = |path: PathBuf, admin: bool, out: &mut Vec<Leftover>| {
        if in_windows(&path) || path.parent().is_none() || holds_other(&path) {
            return;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else { return };
        let kind = if meta.is_dir() { "folder" } else { "file" };
        push(Leftover { kind: kind.into(), size: dir_size(&path), path: path.to_string_lossy().into_owned(), admin }, out);
    };

    if !p.location.is_empty() {
        let loc = PathBuf::from(&p.location);
        // Only when the folder is the program's own, never a shared root like "C:\Program Files".
        let own = loc.file_name().is_some_and(|n| {
            let n = norm(&n.to_string_lossy());
            !PROTECTED.contains(&n.as_str()) && n != publisher && n.len() >= 3
        }) && !roots.iter().any(|(r, _)| r == &loc);
        if own && loc.exists() {
            let admin = roots.iter().any(|(r, a)| *a && loc.starts_with(r)) || p.machine;
            folder(loc, admin, &mut out);
        }
    }
    for (root, admin) in &roots {
        let Ok(rd) = std::fs::read_dir(root) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let path = e.path();
            if matches(&toks, &name) || matches(&toks, Path::new(&name).file_stem().map(|s| s.to_string_lossy()).as_deref().unwrap_or("")) {
                folder(path, *admin, &mut out);
            } else if publisher_ok && norm(&name) == publisher && path.is_dir() {
                // <Publisher>\<Program>: only the program's own child; the publisher folder itself
                // only once it is empty.
                if let Ok(inner) = std::fs::read_dir(&path) {
                    let children: Vec<_> = inner.flatten().collect();
                    if children.is_empty() {
                        folder(path.clone(), *admin, &mut out);
                    }
                    for c in children.iter().filter(|c| matches(&toks, &c.file_name().to_string_lossy())) {
                        folder(c.path(), *admin, &mut out);
                    }
                }
            }
        }
    }

    // Registry.
    let mut key = |hive: &str, view: &str, path: String, out: &mut Vec<Leftover>| {
        if reg::open(hive, view, &path).is_some() {
            push(Leftover { kind: "registry".into(), path: reg::reg_path(hive, view, &path), size: 0, admin: hive == "HKLM" }, out);
        }
    };
    for (hive, view) in [("HKCU", "64"), ("HKLM", "64"), ("HKLM", "32")] {
        let Some(soft) = reg::open(hive, view, "Software") else { continue };
        for name in soft.enum_keys().flatten() {
            if PROTECTED.contains(&norm(&name).as_str()) {
                continue;
            }
            if matches(&toks, &name) {
                key(hive, view, format!(r"Software\{name}"), &mut out);
            } else if publisher_ok && norm(&name) == publisher {
                if let Some(pk) = reg::open(hive, view, &format!(r"Software\{name}")) {
                    let subs: Vec<String> = pk.enum_keys().flatten().collect();
                    if subs.is_empty() && pk.enum_values().next().is_none() {
                        key(hive, view, format!(r"Software\{name}"), &mut out);
                    }
                    for h in subs.iter().filter(|s| matches(&toks, s)) {
                        key(hive, view, format!(r"Software\{name}\{h}"), &mut out);
                    }
                }
            }
        }
    }
    // The Uninstall entry itself, if the uninstaller forgot it.
    if present(&p.key) {
        let mut it = p.key.splitn(3, '|');
        if let (Some(h @ ("HKLM" | "HKCU")), Some(v), Some(s)) = (it.next(), it.next(), it.next()) {
            key(h, v, format!(r"{}\{s}", reg::UNINSTALL), &mut out);
        }
    }
    // Forced removal of a Windows Installer product whose uninstall cannot run (its cached
    // package or source is gone): its registration, so Windows stops listing it.
    if force {
        if let Some(packed) = msi_code(p).and_then(|c| packed_guid(&c)) {
            for (hive, path) in [
                ("HKLM", format!(r"Software\Classes\Installer\Products\{packed}")),
                ("HKLM", format!(r"Software\Classes\Installer\Features\{packed}")),
                ("HKLM", format!(r"Software\Microsoft\Windows\CurrentVersion\Installer\UserData\S-1-5-18\Products\{packed}")),
                ("HKCU", format!(r"Software\Microsoft\Installer\Products\{packed}")),
                ("HKCU", format!(r"Software\Microsoft\Installer\Features\{packed}")),
            ] {
                key(hive, "64", path, &mut out);
            }
        }
    }
    // A key path ending in a deeper match is covered by its parent: drop children of listed keys.
    let all: Vec<String> = out.iter().map(|l| l.path.to_lowercase()).collect();
    out.retain(|l| {
        let me = l.path.to_lowercase();
        !all.iter().any(|o| *o != me && me.starts_with(&format!("{o}\\")))
    });
    out
}

/// Where registry backups go before keys are deleted.
fn backup_dir() -> PathBuf {
    std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir()).join(r"PieDesk\uninstall-backup")
}

/// Removes leftovers in this process: folders/files to the Recycle Bin, keys exported then deleted.
pub fn remove_here(items: &[Leftover], backup: &Path) -> Vec<RemoveResult> {
    let _ = std::fs::create_dir_all(backup);
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    items
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let res = if l.kind == "registry" {
                let file = backup.join(format!("{stamp}-{i}.reg"));
                let file_s = file.to_string_lossy().into_owned();
                crate::cleanup::run_hidden("reg", &["export", &l.path, &file_s, "/y"])
                    .and_then(|_| crate::cleanup::run_hidden("reg", &["delete", &l.path, "/f"]))
                    .map(|_| ())
            } else if Path::new(&l.path).exists() {
                crate::cleanup::recycle(std::slice::from_ref(&l.path))
            } else {
                Ok(())
            };
            RemoveResult { path: l.path.clone(), ok: res.is_ok(), error: res.err() }
        })
        .collect()
}

/// Removes leftovers, asking for admin rights once when some of them need it.
pub fn remove(items: Vec<Leftover>) -> Vec<RemoveResult> {
    let backup = backup_dir();
    let (admin, user): (Vec<_>, Vec<_>) = items.into_iter().partition(|l| l.admin);
    let mut out = remove_here(&user, &backup);
    if !admin.is_empty() {
        let task = crate::elevate::Task::Leftovers { items: admin.clone(), backup: backup.to_string_lossy().into_owned() };
        match crate::elevate::run(vec![task]) {
            Ok(list) => {
                for r in list {
                    if let crate::elevate::Outcome::Leftovers(rs) = r {
                        out.extend(rs);
                    }
                }
            }
            Err(e) => out.extend(admin.into_iter().map(|l| RemoveResult { path: l.path, ok: false, error: Some(e.clone()) })),
        }
    }
    out
}

/// Microsoft Store apps the user can remove (the ones Windows lets go of).
#[cfg(windows)]
pub fn store_apps() -> Result<Vec<StoreApp>, String> {
    let script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-AppxPackage -PackageTypeFilter Main | \
        Where-Object { -not $_.NonRemovable -and -not $_.IsFramework -and $_.SignatureKind -ne 'System' } | \
        ForEach-Object { [pscustomobject]@{ name=$_.Name; fullName=$_.PackageFullName; publisher=($_.Publisher -replace '^CN=([^,]+).*','$1'); version=[string]$_.Version; location=[string]$_.InstallLocation } } | \
        ConvertTo-Json -Compress";
    let out = crate::cleanup::run_hidden("powershell", &["-NoProfile", "-NonInteractive", "-Command", script])?;
    let text = out.trim();
    if text.is_empty() {
        return Ok(Vec::new());
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Raw {
        name: String,
        full_name: String,
        #[serde(default)]
        publisher: Option<String>,
        #[serde(default)]
        version: Option<String>,
        #[serde(default)]
        location: Option<String>,
    }
    let raw: Vec<Raw> = if text.starts_with('[') {
        serde_json::from_str(text).map_err(|e| e.to_string())?
    } else {
        vec![serde_json::from_str(text).map_err(|e| e.to_string())?]
    };
    let mut apps: Vec<StoreApp> = raw
        .into_iter()
        .map(|r| StoreApp {
            name: r.name,
            full_name: r.full_name,
            publisher: r.publisher.unwrap_or_default(),
            version: r.version.unwrap_or_default(),
            location: r.location.unwrap_or_default(),
        })
        .collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    Ok(apps)
}

#[cfg(windows)]
pub fn store_remove(full_name: &str) -> Result<(), String> {
    if !full_name.chars().all(|c| c.is_alphanumeric() || "._-~".contains(c)) {
        return Err("bad package name".into());
    }
    crate::cleanup::run_hidden("powershell", &["-NoProfile", "-NonInteractive", "-Command", &format!("Remove-AppxPackage -Package '{full_name}'")]).map(|_| ())
}

#[cfg(not(windows))]
pub fn list() -> Vec<Program> { Vec::new() }
#[cfg(not(windows))]
pub fn present(_key: &str) -> bool { false }
#[cfg(not(windows))]
pub fn leftovers(_p: &Program, _others: &[String], _force: bool) -> Vec<Leftover> { Vec::new() }
#[cfg(not(windows))]
pub fn store_apps() -> Result<Vec<StoreApp>, String> { Ok(Vec::new()) }
#[cfg(not(windows))]
pub fn store_remove(_n: &str) -> Result<(), String> { Err("unsupported".into()) }

// ---------------------------------------------------------------------------------------------
// Commands

fn find(key: &str) -> Result<Program, String> {
    list().into_iter().find(|p| p.key == key).ok_or_else(|| "not found".to_string())
}

#[tauri::command]
pub async fn uninstall_list() -> Vec<Program> {
    list()
}

#[tauri::command]
pub async fn uninstall_run(key: String, file: Option<String>) -> Result<u32, String> {
    let p = find(&key)?;
    tauri::async_runtime::spawn_blocking(move || run(&p, file.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn uninstall_present(key: String) -> bool {
    present(&key)
}

/// Leftover scan. Takes the program as listed before uninstalling: its entry may be gone now.
#[tauri::command]
pub async fn uninstall_leftovers(program: serde_json::Value, force: Option<bool>) -> Result<Vec<Leftover>, String> {
    let g = |k: &str| program.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let p = Program {
        key: g("key"),
        name: g("name"),
        publisher: g("publisher"),
        version: g("version"),
        installed: String::new(),
        size: 0,
        location: g("location"),
        icon: String::new(),
        uninstall: String::new(),
        quiet: String::new(),
        machine: program.get("machine").and_then(|v| v.as_bool()).unwrap_or(false),
        msi: program.get("msi").and_then(|v| v.as_bool()).unwrap_or(false),
        broken: false,
    };
    if p.name.trim().is_empty() {
        return Err("no name".into());
    }
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let others: Vec<String> = list().into_iter().filter(|o| o.key != p.key).map(|o| o.location).collect();
        leftovers(&p, &others, force.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn uninstall_remove(items: Vec<Leftover>) -> Vec<RemoveResult> {
    tauri::async_runtime::spawn_blocking(move || remove(items)).await.unwrap_or_default()
}

#[tauri::command]
pub async fn store_list() -> Result<Vec<StoreApp>, String> {
    tauri::async_runtime::spawn_blocking(store_apps).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn store_uninstall(full_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || store_remove(&full_name)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prog(name: &str, location: &str) -> Program {
        Program {
            key: "HKCU|64|x".into(),
            name: name.into(),
            publisher: String::new(),
            version: String::new(),
            installed: String::new(),
            size: 0,
            location: location.into(),
            icon: String::new(),
            uninstall: String::new(),
            quiet: String::new(),
            machine: false,
            msi: false,
            broken: false,
        }
    }

    #[test]
    #[ignore]
    fn live_list() {
        let all = list();
        println!("{} programs", all.len());
        for p in all.iter().take(400) {
            let others: Vec<String> = all.iter().filter(|o| o.key != p.key).map(|o| o.location.clone()).collect();
            let l: Vec<_> = leftovers(p, &others, false).into_iter().filter(|l| !l.path.contains(r"CurrentVersion\Uninstall")).collect();
            if !l.is_empty() {
                println!("{} [{}] -> {:?}", p.name, p.location, l.iter().map(|x| &x.path).collect::<Vec<_>>());
            }
        }
    }

    /// `cargo test live_force -- --ignored --nocapture`: what a forced removal of an MSI product
    /// would offer (read-only). PIEDESK_PROGRAM picks the program by name.
    #[test]
    #[ignore]
    fn live_force() {
        let want = std::env::var("PIEDESK_PROGRAM").unwrap_or_else(|_| "DaVinci".into()).to_lowercase();
        let all = list();
        for p in all.iter().filter(|p| p.msi && p.name.to_lowercase().contains(&want)) {
            let others: Vec<String> = all.iter().filter(|o| o.key != p.key).map(|o| o.location.clone()).collect();
            println!("{} [{}] {}", p.name, p.key, p.location);
            for l in leftovers(p, &others, true) {
                println!("  {} {}{}", l.kind, l.path, if l.admin { " (admin)" } else { "" });
            }
        }
    }

    #[test]
    fn packs_product_codes() {
        assert_eq!(packed_guid("{90120000-0030-0000-0000-0000000FF1CE}").as_deref(), Some("00002109030000000000000000F01FEC"));
        assert_eq!(packed_guid("not-a-guid"), None);
        assert_eq!(unpacked_guid("00002109030000000000000000F01FEC").as_deref(), Some("{90120000-0030-0000-0000-0000000FF1CE}"));
    }

    #[test]
    fn strips_versions() {
        assert_eq!(base_name("Notepad++ 8.6.2 (64-bit x64)"), "Notepad++");
        assert_eq!(base_name("7-Zip 23.01 (x64)"), "7-Zip");
        assert_eq!(base_name("Mozilla Firefox (x64 en-US)"), "Mozilla Firefox (x64 en-US)");
        assert_eq!(base_name("VLC media player"), "VLC media player");
    }

    #[test]
    fn tokens_are_exact_and_safe() {
        let t = tokens(&prog("Notepad++ 8.6 (64-bit)", r"C:\Program Files\Notepad++"));
        assert!(matches(&t, "Notepad++"));
        assert!(!matches(&t, "Notepad"));
        // A program called "Windows" or "Microsoft" never matches the system folders.
        assert!(tokens(&prog("Microsoft", "")).is_empty());
        assert!(tokens(&prog("Go", "")).is_empty());
    }

    #[test]
    fn splits_commands() {
        assert_eq!(split_command(r#""C:\a b\unins000.exe" /SILENT"#), (r"C:\a b\unins000.exe".into(), "/SILENT".into()));
        assert_eq!(split_command(r"C:\Program Files\X\uninst.exe /S"), (r"C:\Program Files\X\uninst.exe".into(), "/S".into()));
        assert_eq!(icon_path(r#""C:\x\app.exe",0"#), r"C:\x\app.exe");
        assert_eq!(icon_path(r"C:\x\app.ico"), r"C:\x\app.ico");
        assert_eq!(parse_date("20240131"), "2024-01-31");
    }

    #[test]
    fn publisher_suffixes() {
        assert_eq!(publisher_name("JetBrains s.r.o."), "jetbrainssro");
        assert_eq!(publisher_name("Valve Corporation"), "valve");
        assert_eq!(publisher_name("Mozilla"), "mozilla");
    }
}
