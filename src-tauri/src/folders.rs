//! Folder portal boxes: list a folder and watch it, ref-counted per path.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub ext: String,
}

pub fn list(dir: &str) -> Result<Vec<Entry>, String> {
    let mut out: Vec<Entry> = fs::read_dir(dir)
        .map_err(|e| format!("{dir}: {e}"))?
        .filter_map(Result::ok)
        .filter(|e| !is_hidden(&e.path()))
        .map(|e| {
            let path = e.path();
            let is_dir = path.is_dir();
            Entry {
                name: if is_dir {
                    e.file_name().to_string_lossy().into_owned()
                } else {
                    path.file_stem().unwrap_or_default().to_string_lossy().into_owned()
                },
                ext: if is_dir {
                    String::new()
                } else {
                    path.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default()
                },
                path: path.to_string_lossy().into_owned(),
                is_dir,
            }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

fn is_hidden(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if name == "desktop.ini" || name.starts_with('~') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN_OR_SYSTEM: u32 = 0x2 | 0x4;
        if let Ok(m) = fs::metadata(path) {
            return m.file_attributes() & HIDDEN_OR_SYSTEM != 0;
        }
    }
    false
}

type Watcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

#[derive(Clone, Default)]
pub struct Watches(Arc<Mutex<HashMap<String, (usize, Watcher)>>>);

impl Watches {
    pub fn watch(&self, app: &AppHandle, dir: &str) -> Result<(), String> {
        let mut map = self.0.lock().unwrap();
        if let Some((count, _)) = map.get_mut(dir) {
            *count += 1;
            return Ok(());
        }
        let app = app.clone();
        let key = dir.to_owned();
        let mut debouncer = new_debouncer(Duration::from_millis(300), None, move |res: DebounceEventResult| {
            if res.is_ok() {
                let _ = app.emit("folder://changed", &key);
            }
        })
        .map_err(|e| e.to_string())?;
        debouncer.watch(Path::new(dir), RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
        map.insert(dir.to_owned(), (1, debouncer));
        Ok(())
    }

    pub fn unwatch(&self, dir: &str) {
        let mut map = self.0.lock().unwrap();
        if let Some((count, _)) = map.get_mut(dir) {
            *count -= 1;
            if *count == 0 {
                map.remove(dir);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_dirs_first_and_skips_desktop_ini() {
        let dir = std::env::temp_dir().join(format!("piedesk-folders-{}", std::process::id()));
        fs::create_dir_all(dir.join("Zeta")).unwrap();
        fs::write(dir.join("alpha.txt"), "a").unwrap();
        fs::write(dir.join("desktop.ini"), "").unwrap();
        let entries = list(dir.to_str().unwrap()).unwrap();
        let names: Vec<_> = entries.iter().map(|e| (e.name.as_str(), e.ext.as_str())).collect();
        assert_eq!(names, vec![("Zeta", ""), ("alpha", "txt")]);
        let _ = fs::remove_dir_all(dir);
    }
}
