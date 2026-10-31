//! Sorts installed programs into groups (code editors, IDEs, game engines, 3D…) for
//! "Group apps into boxes".
//!
//! Programs come from the desktop and both Start Menus (same filters as `apps::gather`). Each is
//! scored against `rules/apps.json`: exe name, install path, URL scheme, the exe's CompanyName /
//! FileDescription, and words in the shortcut name or Start Menu folder. The best group with
//! enough points wins, else "other". A group the user picked for a program overrides the rules.
//!
//! The Start Menu is watched so a newly installed program can drop into its group's box.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::apps;

const DEFAULT_RULES: &str = include_str!("../rules/apps.json");
/// Fewer points than one word match means "other".
const MIN_SCORE: u32 = 3;

#[derive(Debug, Clone, Deserialize)]
pub struct Group {
    pub id: String,
    pub vi: String,
    pub en: String,
    #[serde(default)]
    exe: Vec<String>,
    #[serde(default)]
    path: Vec<String>,
    #[serde(default)]
    scheme: Vec<String>,
    #[serde(default)]
    company: Vec<String>,
    #[serde(default)]
    words: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Rules {
    pub groups: Vec<Group>,
}

impl Rules {
    /// `<config>/app-rules.json` when present and valid, else the built-in rules.
    pub fn load(config_dir: &Path) -> Self {
        fs::read_to_string(config_dir.join("app-rules.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_else(|| serde_json::from_str(DEFAULT_RULES).expect("built-in rules/apps.json"))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInfo {
    pub id: String,
    pub vi: String,
    pub en: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    /// What the shortcut opens, lowercased (`items::target_key`): the program's identity.
    pub key: String,
    pub name: String,
    /// The shortcut to take into a box.
    pub link: String,
    /// The link is on the desktop (moves into the box) rather than in the Start Menu (copied).
    pub on_desktop: bool,
    pub group: String,
    /// What the rules say, before the user's override.
    pub guess: String,
}

#[derive(Debug, Serialize)]
pub struct Catalog {
    pub groups: Vec<GroupInfo>,
    pub apps: Vec<App>,
}

/// Every program on the desktop and in `menus` that has no shortcut in a box yet (`taken` keys).
pub fn scan(rules: &Rules, menus: &[PathBuf], desktop: &Path, taken: &HashSet<String>, overrides: &HashMap<String, String>) -> Catalog {
    let mut found: Vec<(PathBuf, bool)> = shortcuts_in(desktop).into_iter().map(|p| (p, true)).collect();
    for dir in menus {
        found.extend(apps::walk(dir).into_iter().map(|p| (p, false)));
    }
    let mut seen_keys = HashSet::new();
    let mut seen_names = HashSet::new();
    let mut out = Vec::new();
    for (link, on_desktop) in found {
        let Some(key) = apps::program_key(&link) else { continue };
        let name = link.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        if taken.contains(&key) || !seen_keys.insert(key.clone()) || !seen_names.insert(name.to_lowercase()) {
            continue;
        }
        let folder = link.parent().and_then(|p| p.file_name()).map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        let guess = classify(rules, &key, &name, &folder, &version_text(&key));
        let group = overrides.get(&key).cloned().unwrap_or_else(|| guess.clone());
        out.push(App { key, name, link: link.to_string_lossy().into_owned(), on_desktop, group, guess });
    }
    out.sort_by(|a, b| a.group.cmp(&b.group).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let groups = rules.groups.iter().map(|g| GroupInfo { id: g.id.clone(), vi: g.vi.clone(), en: g.en.clone() }).collect();
    Catalog { groups, apps: out }
}

fn shortcuts_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk") || e.eq_ignore_ascii_case("url")))
        .collect()
}

/// Group id for a program. `key` is its lowercased target (exe path or URL), `text` the exe's
/// lowercased CompanyName + FileDescription.
pub fn classify(rules: &Rules, key: &str, name: &str, folder: &str, text: &str) -> String {
    let exe = Path::new(key).file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
    let is_url = key.contains("://");
    let label = format!("{} {}", name.to_lowercase(), folder.to_lowercase());
    let mut best = ("other", 0u32);
    for g in &rules.groups {
        let mut score = 0;
        if !is_url && g.exe.iter().any(|p| glob(&p.to_lowercase(), &exe)) {
            score += 10;
        }
        if g.scheme.iter().any(|s| key.starts_with(s.as_str())) {
            score += 10;
        }
        if !is_url && g.path.iter().any(|p| key.contains(p.as_str())) {
            score += 6;
        }
        if !text.is_empty() && g.company.iter().any(|c| text.contains(c.as_str())) {
            score += 4;
        }
        if g.words.iter().any(|w| has_word(&label, w)) {
            score += 3;
        }
        if score > best.1 {
            best = (g.id.as_str(), score);
        }
    }
    if best.1 >= MIN_SCORE { best.0.to_owned() } else { "other".into() }
}

/// `*` matches any run of characters; everything else literally.
fn glob(pattern: &str, text: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == text;
    }
    let (first, last) = (parts[0], parts[parts.len() - 1]);
    if !text.starts_with(first) || !text.ends_with(last) || text.len() < first.len() + last.len() {
        return false;
    }
    let mut rest = &text[first.len()..text.len() - last.len()];
    for mid in &parts[1..parts.len() - 1] {
        match rest.find(mid) {
            Some(i) => rest = &rest[i + mid.len()..],
            None => return false,
        }
    }
    true
}

/// `word` appears in `text` with no letter or digit right before or after it.
fn has_word(text: &str, word: &str) -> bool {
    let word = word.to_lowercase();
    let word = word.trim();
    text.match_indices(word).any(|(i, _)| {
        let before = text[..i].chars().next_back();
        let after = text[i + word.len()..].chars().next();
        !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
    })
}

/// Lowercased CompanyName + FileDescription of an exe, or "" when it has none.
#[cfg(windows)]
fn version_text(path: &str) -> String {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

    if !path.ends_with(".exe") {
        return String::new();
    }
    let file = HSTRING::from(path);
    unsafe {
        let size = GetFileVersionInfoSizeW(&file, None);
        if size == 0 {
            return String::new();
        }
        let mut data = vec![0u8; size as usize];
        if GetFileVersionInfoW(&file, None, size, data.as_mut_ptr().cast()).is_err() {
            return String::new();
        }
        let query = |sub: &str| -> Option<(*mut core::ffi::c_void, u32)> {
            let mut ptr = std::ptr::null_mut();
            let mut len = 0u32;
            VerQueryValueW(data.as_ptr().cast(), PCWSTR(HSTRING::from(sub).as_ptr()), &mut ptr, &mut len)
                .as_bool()
                .then_some((ptr, len))
        };
        // First language / code page pair, falling back to US English + Unicode.
        let lang = query(r"\VarFileInfo\Translation")
            .filter(|(_, len)| *len >= 4)
            .map(|(p, _)| {
                let pair = p as *const u16;
                format!("{:04x}{:04x}", *pair, *pair.add(1))
            })
            .unwrap_or_else(|| "040904b0".into());
        let mut out = String::new();
        for field in ["CompanyName", "FileDescription"] {
            if let Some((p, len)) = query(&format!(r"\StringFileInfo\{lang}\{field}")) {
                let s = std::slice::from_raw_parts(p as *const u16, len as usize);
                let end = s.iter().position(|&c| c == 0).unwrap_or(s.len());
                out.push_str(&String::from_utf16_lossy(&s[..end]).to_lowercase());
                out.push(' ');
            }
        }
        out
    }
}

#[cfg(not(windows))]
fn version_text(_path: &str) -> String {
    String::new()
}

// ---------------------------------------------------------------------------------------------

static WATCHER: Mutex<Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>> = Mutex::new(None);

/// Emits `apps://changed` a few seconds after anything in the Start Menus changes (installers
/// write several files in a row).
pub fn watch(app: &AppHandle) {
    let app = app.clone();
    let Ok(mut debouncer) = new_debouncer(Duration::from_secs(4), None, move |res: DebounceEventResult| {
        if res.is_ok() {
            let _ = app.emit("apps://changed", ());
        }
    }) else {
        return;
    };
    for dir in apps::start_menu_dirs() {
        let _ = debouncer.watch(&dir, RecursiveMode::Recursive);
    }
    *WATCHER.lock().unwrap() = Some(debouncer);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> Rules {
        serde_json::from_str(DEFAULT_RULES).unwrap()
    }

    #[test]
    fn globs() {
        assert!(glob("godot*.exe", "godot_v4.3-stable_win64.exe"));
        assert!(glob("adobe substance 3d *.exe", "adobe substance 3d painter.exe"));
        assert!(!glob("godot*.exe", "agodot.exe"));
        assert!(glob("code.exe", "code.exe"));
        assert!(!glob("code.exe", "vscode.exe"));
    }

    #[test]
    fn words_need_boundaries() {
        assert!(has_word("unreal engine 5.4", "unreal engine"));
        assert!(!has_word("knowledge base", "edge"));
        assert!(has_word("microsoft edge", "edge"));
    }

    #[test]
    fn classifies_common_programs() {
        let r = rules();
        let c = |key: &str, name: &str, folder: &str, text: &str| classify(&r, key, name, folder, text);
        assert_eq!(c(r"c:\users\a\appdata\local\programs\microsoft vs code\code.exe", "Visual Studio Code", "Programs", ""), "code");
        assert_eq!(c(r"c:\program files\jetbrains\rider 2025.2\bin\rider64.exe", "Rider", "JetBrains", "jetbrains s.r.o."), "ide");
        assert_eq!(c(r"m:\ue_5.6\engine\binaries\win64\unrealeditor.exe", "Unreal Engine 5.6", "", ""), "engine");
        assert_eq!(c(r"c:\program files\blender foundation\blender 4.5\blender-launcher.exe", "Blender 4.5", "", ""), "dcc");
        assert_eq!(c(r"c:\program files\autodesk\maya2026\bin\maya.exe", "Maya 2026", "Autodesk Maya 2026", ""), "dcc");
        assert_eq!(c("steam://rungameid/570", "Dota 2", "Steam", ""), "game");
        assert_eq!(c(r"d:\steamlibrary\steamapps\common\hades\hades.exe", "Hades", "", ""), "game");
        assert_eq!(c(r"c:\program files\google\chrome\application\chrome.exe", "Google Chrome", "", ""), "browser");
        assert_eq!(c(r"c:\users\a\appdata\local\discord\update.exe", "Discord", "Discord Inc", ""), "chat");
        assert_eq!(c(r"c:\program files\microsoft office\root\office16\winword.exe", "Word", "", ""), "office");
        assert_eq!(c(r"c:\tools\mystery.exe", "Mystery", "", ""), "other");
    }

    /// `cargo test live_catalog -- --ignored --nocapture`: how this PC's programs are grouped.
    #[test]
    #[ignore]
    fn live_catalog() {
        let desktop = PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Desktop");
        let cat = scan(&rules(), &apps::start_menu_dirs(), &desktop, &HashSet::new(), &HashMap::new());
        let mut by: std::collections::BTreeMap<&str, Vec<&str>> = Default::default();
        for a in &cat.apps {
            by.entry(a.group.as_str()).or_default().push(a.name.as_str());
        }
        for (g, names) in by {
            println!("{g} ({}): {}", names.len(), names.join(" | "));
        }
    }
}
