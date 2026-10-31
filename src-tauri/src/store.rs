//! Single source of truth for settings, boxes and widgets.
//!
//! Every surface window (one per monitor) and the manager window send *ops* instead of whole
//! documents, so two windows never overwrite each other. Rust applies the ops, bumps `rev`,
//! re-broadcasts them and writes the file after a short quiet period (atomic rename), or at the
//! latest `MAX_DELAY` after the first unsaved change, so a steady stream of ops cannot postpone
//! the save forever. Startup and write failures go to a log file kept outside the data folder.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::io::Write as _;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const SAVE_DELAY: Duration = Duration::from_millis(400);
const MAX_DELAY: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Doc {
    pub rev: u64,
    pub settings: Value,
    pub boxes: BTreeMap<String, Value>,
    pub widgets: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Coll {
    Boxes,
    Widgets,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Op {
    Upsert { coll: Coll, id: String, value: Value },
    Delete { coll: Coll, id: String },
    /// Shallow-merges the given object into `settings`.
    Settings { value: Value },
}

impl Doc {
    pub fn apply(&mut self, ops: &[Op]) {
        for op in ops {
            match op {
                Op::Upsert { coll, id, value } => {
                    self.coll_mut(*coll).insert(id.clone(), value.clone());
                }
                Op::Delete { coll, id } => {
                    self.coll_mut(*coll).remove(id);
                }
                Op::Settings { value } => {
                    if !self.settings.is_object() {
                        self.settings = Value::Object(Default::default());
                    }
                    if let (Some(dst), Some(src)) = (self.settings.as_object_mut(), value.as_object()) {
                        for (k, v) in src {
                            dst.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
        }
        self.rev += 1;
    }

    fn coll_mut(&mut self, coll: Coll) -> &mut BTreeMap<String, Value> {
        match coll {
            Coll::Boxes => &mut self.boxes,
            Coll::Widgets => &mut self.widgets,
        }
    }

    pub fn setting_bool(&self, key: &str, default: bool) -> bool {
        self.settings.get(key).and_then(Value::as_bool).unwrap_or(default)
    }

    pub fn setting_str(&self, key: &str) -> Option<String> {
        self.settings.get(key).and_then(Value::as_str).map(str::to_owned)
    }
}

struct Inner {
    doc: Mutex<Doc>,
    dirty: Mutex<bool>,
    wake: Condvar,
    path: PathBuf,
    log: Option<PathBuf>,
}

#[derive(Clone)]
pub struct Store(Arc<Inner>);

impl Store {
    /// `log`: where startup and save failures are appended (`None` in tests).
    pub fn open(path: PathBuf, log: Option<PathBuf>) -> Self {
        let read = fs::read(&path);
        let doc = read.as_ref().ok().and_then(|bytes| serde_json::from_slice::<Doc>(bytes).ok()).unwrap_or_default();
        let note = match &read {
            Ok(_) => format!("store {} loaded rev {}", path.display(), doc.rev),
            Err(e) => format!("store {} not loaded: {e}", path.display()),
        };
        let store = Store(Arc::new(Inner { doc: Mutex::new(doc), dirty: Mutex::new(false), wake: Condvar::new(), path, log }));
        store.log(&note);
        let writer = store.clone();
        std::thread::Builder::new().name("store-writer".into()).spawn(move || writer.writer_loop()).ok();
        store
    }

    pub fn snapshot(&self) -> Doc {
        self.0.doc.lock().unwrap().clone()
    }

    pub fn read<R>(&self, f: impl FnOnce(&Doc) -> R) -> R {
        f(&self.0.doc.lock().unwrap())
    }

    pub fn apply(&self, ops: &[Op]) -> u64 {
        let rev = {
            let mut doc = self.0.doc.lock().unwrap();
            doc.apply(ops);
            doc.rev
        };
        *self.0.dirty.lock().unwrap() = true;
        self.0.wake.notify_one();
        rev
    }

    /// Writes immediately and unconditionally (used on exit and before an update installs).
    pub fn flush(&self) {
        *self.0.dirty.lock().unwrap() = false;
        self.write();
    }

    fn writer_loop(&self) {
        loop {
            let mut dirty = self.0.dirty.lock().unwrap();
            while !*dirty {
                dirty = self.0.wake.wait(dirty).unwrap();
            }
            // Debounce: keep waiting while new ops keep arriving, but never past MAX_DELAY.
            let first = Instant::now();
            loop {
                *dirty = false;
                let (guard, timeout) = self.0.wake.wait_timeout(dirty, SAVE_DELAY).unwrap();
                dirty = guard;
                if (timeout.timed_out() && !*dirty) || first.elapsed() >= MAX_DELAY {
                    *dirty = false;
                    break;
                }
            }
            drop(dirty);
            self.write();
        }
    }

    fn write(&self) {
        let bytes = match serde_json::to_vec_pretty(&self.snapshot()) {
            Ok(b) => b,
            Err(e) => return self.log(&format!("serialize failed: {e}")),
        };
        if let Some(dir) = self.0.path.parent() {
            if let Err(e) = fs::create_dir_all(dir) {
                self.log(&format!("create {} failed: {e}", dir.display()));
            }
        }
        let tmp = self.0.path.with_extension("json.tmp");
        if let Err(e) = fs::write(&tmp, bytes).and_then(|_| fs::rename(&tmp, &self.0.path)) {
            self.log(&format!("save failed: {e}"));
        }
    }

    pub fn log(&self, line: &str) {
        let Some(path) = &self.0.log else { return };
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{stamp} {line}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ops_roundtrip_and_apply() {
        let ops: Vec<Op> = serde_json::from_value(json!([
            { "op": "upsert", "coll": "boxes", "id": "a", "value": { "title": "Gadgets" } },
            { "op": "upsert", "coll": "widgets", "id": "w", "value": { "type": "clock" } },
            { "op": "settings", "value": { "lock": true } },
            { "op": "settings", "value": { "grid": 8 } },
            { "op": "delete", "coll": "widgets", "id": "w" }
        ]))
        .unwrap();
        let mut doc = Doc::default();
        doc.apply(&ops);
        assert_eq!(doc.rev, 1);
        assert_eq!(doc.boxes["a"]["title"], "Gadgets");
        assert!(doc.widgets.is_empty());
        assert!(doc.setting_bool("lock", false));
        assert_eq!(doc.settings["grid"], 8);
    }

    #[test]
    fn steady_ops_still_get_saved() {
        let dir = std::env::temp_dir().join(format!("piedesk-steady-{}", std::process::id()));
        let path = dir.join("state.json");
        let store = Store::open(path.clone(), None);
        // An op every 100 ms never leaves a 400 ms quiet gap; MAX_DELAY must save anyway.
        for i in 0..35 {
            store.apply(&[Op::Settings { value: json!({ "n": i }) }]);
            std::thread::sleep(Duration::from_millis(100));
        }
        let saved: Doc = serde_json::from_slice(&fs::read(&path).expect("saved while busy")).unwrap();
        assert!(saved.settings["n"].as_i64().unwrap() > 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn store_persists_atomically() {
        let dir = std::env::temp_dir().join(format!("piedesk-test-{}", std::process::id()));
        let path = dir.join("state.json");
        let store = Store::open(path.clone(), None);
        store.apply(&[Op::Settings { value: json!({ "x": 1 }) }]);
        store.flush();
        let reopened = Store::open(path, None);
        assert_eq!(reopened.snapshot().settings["x"], 1);
        let _ = fs::remove_dir_all(dir);
    }
}
