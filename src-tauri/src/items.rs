//! Box items own their shortcut.
//!
//! A shortcut dropped into a box *moves* into it, like an icon moved into a fence: the box keeps
//! the only copy in `<app data>/shortcuts`, so there are never two of the same icon on screen.
//! When the original cannot be deleted (e.g. `C:\Users\Public\Desktop` needs admin rights) it is
//! hidden instead. Anything else (exe, document, folder) stays where it is and the box gets a new
//! `.lnk` to it. Taking an item out of a box puts a moved / hidden shortcut back where it was.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const SHORTCUT_EXT: [&str; 3] = ["lnk", "url", "pif"];

/// What happened to the original when it was taken into a box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// Deleted: the box holds the only copy.
    Moved,
    /// Could not be deleted, so it was hidden.
    Hidden,
    /// Left alone (not a shortcut, or neither delete nor hide worked).
    Kept,
}

#[derive(Debug, Serialize)]
pub struct Imported {
    pub path: String,
    pub origin: Origin,
}

fn is_shortcut(p: &Path) -> bool {
    p.is_file() && p.extension().is_some_and(|e| SHORTCUT_EXT.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

/// Takes `source` into a box and returns the box's own shortcut.
pub fn import(dir: &Path, source: &str) -> Result<Imported, String> {
    let src = Path::new(source);
    if !src.exists() {
        return Err(format!("not found: {source}"));
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let name = src.file_stem().or_else(|| src.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "item".into());
    if is_shortcut(src) {
        let ext = src.extension().unwrap_or_default().to_string_lossy().to_lowercase();
        let dest = unique(dir, &name, &ext);
        fs::copy(src, &dest).map_err(|e| e.to_string())?;
        let origin = take_original(src);
        return Ok(Imported { path: dest.to_string_lossy().into_owned(), origin });
    }
    let dest = unique(dir, &name, "lnk");
    create_link(src, &dest)?;
    Ok(Imported { path: dest.to_string_lossy().into_owned(), origin: Origin::Kept })
}

/// For items imported before shortcuts moved into boxes: take the original off the desktop now.
pub fn claim(dir: &Path, path: &str, source: &str) -> Origin {
    let src = Path::new(source);
    if is_owned(dir, path) && Path::new(path).exists() && is_shortcut(src) {
        take_original(src)
    } else {
        Origin::Kept
    }
}

/// Removes the original once the box has its copy: delete it, or hide it when that is refused.
fn take_original(src: &Path) -> Origin {
    if fs::remove_file(src).is_ok() {
        Origin::Moved
    } else if set_hidden(src, true) {
        Origin::Hidden
    } else {
        Origin::Kept
    }
}

/// Takes an item out of a box. A moved shortcut goes back to `source` (or next to it when the name
/// is taken now), a hidden one is shown again; the box's copy is deleted either way.
pub fn release(dir: &Path, path: &str, source: Option<&str>, origin: Option<Origin>, fallback: &Path) {
    let own = Path::new(path);
    if !is_owned(dir, path) {
        return;
    }
    if let Some(src) = source.map(Path::new) {
        match origin {
            Some(Origin::Hidden) if src.exists() => {
                set_hidden(src, false);
            }
            Some(Origin::Moved | Origin::Hidden) => {
                let parent = src.parent().filter(|p| p.is_dir()).unwrap_or(fallback);
                let stem = src.file_stem().unwrap_or_default().to_string_lossy();
                let ext = src.extension().unwrap_or_default().to_string_lossy();
                let back = if src.exists() { unique(parent, &stem, &ext) } else { parent.join(src.file_name().unwrap_or_default()) };
                if fs::rename(own, &back).is_ok() || fs::copy(own, &back).is_ok() {
                    let _ = fs::remove_file(own);
                    return;
                }
                return; // could not put it back: keep the box's copy rather than lose the shortcut
            }
            _ => {}
        }
    }
    let _ = fs::remove_file(own);
}

pub fn is_owned(dir: &Path, path: &str) -> bool {
    Path::new(path).parent().is_some_and(|parent| same_dir(parent, dir))
}

fn same_dir(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().trim_end_matches(['\\', '/']).eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches(['\\', '/']))
}

/// `Name.lnk`, or `Name (2).lnk`… when taken. Characters Windows rejects become `_`.
fn unique(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let clean: String = name.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c }).collect();
    let clean = if clean.trim().is_empty() { "item".to_owned() } else { clean };
    let mut path = dir.join(format!("{clean}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{clean} ({n}).{ext}"));
        n += 1;
    }
    path
}

#[cfg(windows)]
fn set_hidden(path: &Path, hidden: bool) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_FLAGS_AND_ATTRIBUTES};
    let Ok(meta) = fs::metadata(path) else { return false };
    let attrs = if hidden { meta.file_attributes() | FILE_ATTRIBUTE_HIDDEN.0 } else { meta.file_attributes() & !FILE_ATTRIBUTE_HIDDEN.0 };
    unsafe { SetFileAttributesW(&HSTRING::from(path.as_os_str()), FILE_FLAGS_AND_ATTRIBUTES(attrs)).is_ok() }
}

#[cfg(not(windows))]
fn set_hidden(_path: &Path, _hidden: bool) -> bool {
    false
}

#[cfg(windows)]
fn create_link(target: &Path, dest: &Path) -> Result<(), String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    unsafe {
        // Commands run on worker threads: make sure this one has COM (S_FALSE when it already does).
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
        link.SetPath(&HSTRING::from(target.as_os_str())).map_err(|e| e.to_string())?;
        if let Some(dir) = target.parent().filter(|_| target.is_file()) {
            let _ = link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()));
        }
        let file: IPersistFile = link.cast().map_err(|e| e.to_string())?;
        file.Save(&HSTRING::from(dest.as_os_str()), true).map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
fn create_link(target: &Path, dest: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, dest).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("piedesk-items-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn url(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, "[InternetShortcut]\r\nURL=https://example.com\r\n").unwrap();
        p
    }

    #[test]
    fn moves_shortcut_in_and_back_out() {
        let desk = temp("desk");
        let own = temp("own");
        let src = url(&desk, "Tool.url");
        let item = import(&own, src.to_str().unwrap()).unwrap();
        assert_eq!(item.origin, Origin::Moved);
        assert!(!src.exists(), "only the box's copy is left");
        assert!(Path::new(&item.path).exists());
        release(&own, &item.path, src.to_str(), Some(item.origin), &desk);
        assert!(src.exists(), "taking it out puts it back on the desktop");
        assert!(!Path::new(&item.path).exists());
        let _ = (fs::remove_dir_all(desk), fs::remove_dir_all(own));
    }

    #[cfg(windows)]
    #[test]
    fn hides_what_it_cannot_delete_and_shows_it_again() {
        use std::os::windows::fs::MetadataExt;
        let desk = temp("hide");
        let own = temp("own-hide");
        let src = url(&desk, "Locked.url");
        // Hold the file open without delete sharing: removal fails, hiding still works.
        let lock = {
            use std::os::windows::fs::OpenOptionsExt;
            fs::OpenOptions::new().read(true).share_mode(0x1 | 0x2).open(&src).unwrap()
        };
        let item = import(&own, src.to_str().unwrap()).unwrap();
        assert_eq!(item.origin, Origin::Hidden);
        assert!(fs::metadata(&src).unwrap().file_attributes() & 0x2 != 0);
        release(&own, &item.path, src.to_str(), Some(item.origin), &desk);
        assert!(fs::metadata(&src).unwrap().file_attributes() & 0x2 == 0);
        drop(lock);
        let _ = (fs::remove_dir_all(desk), fs::remove_dir_all(own));
    }

    #[cfg(windows)]
    #[test]
    fn links_plain_files_and_leaves_them() {
        let own = temp("lnk");
        let item = import(&own, r"C:\Windows\System32\notepad.exe").unwrap();
        assert!(item.path.ends_with("notepad.lnk"));
        assert_eq!(item.origin, Origin::Kept);
        release(&own, &item.path, Some(r"C:\Windows\System32\notepad.exe"), Some(Origin::Kept), &own);
        assert!(!Path::new(&item.path).exists());
        assert!(Path::new(r"C:\Windows\System32\notepad.exe").exists());
        let _ = fs::remove_dir_all(own);
    }

    #[test]
    fn claims_originals_of_older_items() {
        let desk = temp("claim");
        let own = temp("own-claim");
        let src = url(&desk, "Old.url");
        let copy = own.join("Old.url");
        fs::copy(&src, &copy).unwrap();
        assert_eq!(claim(&own, copy.to_str().unwrap(), src.to_str().unwrap()), Origin::Moved);
        assert!(!src.exists());
        let _ = (fs::remove_dir_all(desk), fs::remove_dir_all(own));
    }
}
