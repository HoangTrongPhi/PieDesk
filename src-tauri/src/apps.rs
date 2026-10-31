//! "Gather app shortcuts": puts a shortcut for every installed program on the desktop, so the user
//! can drag them into boxes.
//!
//! Source is the Start Menu (per-user and all-users), which is where installers register their
//! programs. Uninstallers, readmes, help and web links, and Windows' own tool folders are left out,
//! and so is any program that already has a shortcut in a box or on the desktop.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::items::{target_key, unique};

/// Start Menu folders that only hold Windows' own tools.
const SKIP_FOLDERS: [&str; 7] =
    ["windows tools", "administrative tools", "accessibility", "windows powershell", "system tools", "maintenance", "startup"];

/// Shortcut names that are not programs to launch: uninstallers, docs, and setup / diagnostic
/// helpers that installers drop next to the real program.
const SKIP_NAMES: &[&str] = &[
    "uninstall", "gỡ cài đặt", "gỡ bỏ", "remove", "readme", "read me", "help", "manual", "documentation", "license",
    "release notes", "changelog", "website", "web site", "support", "faq", "what's new", "repair", "safe mode", "report a",
    "administrative tools", "language preferences", "telemetry", "spreadsheet compare", "recording manager", "install additional",
    "application verifier", "app cert kit", "software development kit", "developer powershell", "developer command prompt",
    "visual studio installer", "speed test", "proxy generator", "control panels", "steps recorder", "idle (", "python 3",
    "git cmd", "git gui", "command prompt", "debuggable",
];

#[derive(Debug, Default, Serialize)]
pub struct Gathered {
    /// Names of the shortcuts put on the desktop.
    pub added: Vec<String>,
    /// Programs skipped because they already have a shortcut in a box or on the desktop.
    pub already: usize,
}

/// The per-user and all-users Start Menu `Programs` folders.
pub fn start_menu_dirs() -> Vec<PathBuf> {
    ["APPDATA", "ProgramData"]
        .iter()
        .filter_map(|var| std::env::var_os(var))
        .map(|root| PathBuf::from(root).join(r"Microsoft\Windows\Start Menu\Programs"))
        .filter(|p| p.is_dir())
        .collect()
}

/// Copies a shortcut for each program found in `sources` onto `desktop`, skipping programs whose
/// shortcut is in `taken` (box items) or already on the desktop.
pub fn gather(sources: &[PathBuf], desktop: &Path, taken: &[String]) -> Gathered {
    let mut seen: HashSet<String> = taken.iter().map(|p| target_key(Path::new(p))).collect();
    // PieDesk itself is already on screen.
    if let Ok(me) = std::env::current_exe() {
        seen.insert(me.to_string_lossy().to_lowercase());
    }
    if let Ok(entries) = fs::read_dir(desktop) {
        seen.extend(entries.flatten().map(|e| target_key(&e.path())));
    }
    let mut out = Gathered::default();
    let mut names = HashSet::new();
    for dir in sources {
        for link in walk(dir) {
            let Some(key) = program_key(&link) else { continue };
            let stem = link.file_stem().unwrap_or_default().to_string_lossy().into_owned();
            if seen.contains(&key) {
                out.already += 1;
                continue;
            }
            // The same program is often listed in both Start Menus, sometimes under two names.
            if !names.insert(stem.to_lowercase()) {
                continue;
            }
            seen.insert(key);
            let ext = link.extension().unwrap_or_default().to_string_lossy().to_lowercase();
            if fs::copy(&link, unique(desktop, &stem, &ext)).is_ok() {
                out.added.push(stem);
            }
        }
    }
    out
}

/// Shortcut files under `dir`, skipping Windows' tool folders.
fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if path.is_dir() {
            if !SKIP_FOLDERS.contains(&name.as_str()) {
                out.extend(walk(&path));
            }
        } else if name.ends_with(".lnk") || name.ends_with(".url") {
            out.push(path);
        }
    }
    out
}

/// The key of a launchable program, or `None` for uninstallers, docs and web links.
fn program_key(link: &Path) -> Option<String> {
    let name = link.file_stem()?.to_string_lossy().to_lowercase();
    if SKIP_NAMES.iter().any(|s| name.contains(s)) {
        return None;
    }
    let key = target_key(link);
    if key.ends_with(".url") || key.ends_with(".lnk") {
        return None; // unresolved
    }
    if link.extension().is_some_and(|e| e.eq_ignore_ascii_case("url")) {
        // Game launchers (steam://, com.epicgames.launcher://…) yes, plain web pages no.
        return (!key.starts_with("http")).then_some(key);
    }
    let exe = Path::new(&key);
    let file = exe.file_name()?.to_string_lossy().into_owned();
    let launchable = file.ends_with(".exe") && !file.starts_with("unins") && !file.contains("uninstall") && exe.exists();
    launchable.then_some(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("piedesk-apps-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn url(dir: &Path, name: &str, target: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, format!("[InternetShortcut]\r\nURL={target}\r\n")).unwrap();
        p
    }

    /// `cargo test live_gather -- --ignored --nocapture`: what this PC's Start Menu would give
    /// (written to a temp folder, not the real desktop).
    #[test]
    #[ignore]
    fn live_gather() {
        let desk = temp("live");
        let got = gather(&start_menu_dirs(), &desk, &[]);
        println!("{} programs: {}", got.added.len(), got.added.join(" | "));
        let _ = fs::remove_dir_all(desk);
    }

    #[test]
    fn gathers_launchers_and_skips_the_rest() {
        let menu = temp("menu");
        let desk = temp("desk");
        fs::create_dir_all(menu.join("Game Co")).unwrap();
        url(&menu.join("Game Co"), "Space Game.url", "steam://rungameid/1");
        url(&menu.join("Game Co"), "Space Game Website.url", "https://example.com");
        url(&menu, "Uninstall Space Game.url", "steam://uninstall/1");
        fs::create_dir_all(menu.join("Windows Tools")).unwrap();
        url(&menu.join("Windows Tools"), "Tool.url", "ms-tool://x");
        let in_box = url(&temp("box"), "Racer.url", "steam://rungameid/2");
        url(&menu, "Racer.url", "steam://rungameid/2");

        let taken = [in_box.to_string_lossy().into_owned()];
        let got = gather(&[menu.clone()], &desk, &taken);
        assert_eq!(got.added, vec!["Space Game"]);
        assert!(desk.join("Space Game.url").exists());
        // Running again adds nothing: the desktop copy now counts as taken.
        assert!(gather(&[menu.clone()], &desk, &taken).added.is_empty());
        let _ = (fs::remove_dir_all(menu), fs::remove_dir_all(desk));
    }
}
