//! System data hub: pub/sub with per-topic ref counts.
//!
//! Nothing is measured unless a widget subscribed to that topic, and nothing at all while the
//! fullscreen guard has paused the app. Topics emit `hub://<topic>` once per second
//! (`agents` every 2 s, `disk` every 10 s). `agents` keeps running while paused, so a finished
//! session still raises its notification during a game.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::json;
use sysinfo::{Disks, Networks, RefreshKind, System};
use tauri::{AppHandle, Emitter};

use crate::agents::Agents;

pub const TOPICS: [&str; 5] = ["cpu", "mem", "net", "disk", "agents"];
const TICK: Duration = Duration::from_secs(1);

#[derive(Clone, Default)]
pub struct Hub {
    subs: Arc<Mutex<HashMap<String, usize>>>,
    pub paused: Arc<AtomicBool>,
}

impl Hub {
    pub fn subscribe(&self, topic: &str) -> Result<(), String> {
        if !TOPICS.contains(&topic) {
            return Err(format!("unknown topic {topic}"));
        }
        *self.subs.lock().unwrap().entry(topic.to_owned()).or_default() += 1;
        Ok(())
    }

    pub fn unsubscribe(&self, topic: &str) {
        let mut subs = self.subs.lock().unwrap();
        if let Some(n) = subs.get_mut(topic) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                subs.remove(topic);
            }
        }
    }

    fn active(&self, topic: &str) -> bool {
        self.subs.lock().unwrap().contains_key(topic)
    }

    pub fn start(&self, app: AppHandle) {
        let hub = self.clone();
        std::thread::Builder::new()
            .name("hub".into())
            .spawn(move || {
                let Ok(mut sys) = System::new_with_specifics(RefreshKind::nothing()) else { return };
                let mut nets: Option<Networks> = None;
                let mut tick: u64 = 0;
                let mut last_net = Instant::now();
                let mut agents = Agents::default();
                loop {
                    std::thread::sleep(TICK);
                    tick += 1;
                    if hub.active("agents") && tick % 2 == 0 {
                        let (sessions, finished) = agents.scan();
                        crate::notify_finished(&app, &sessions, &finished);
                        let _ = app.emit("hub://agents", json!({ "sessions": sessions, "finished": finished }));
                    }
                    if hub.paused.load(Ordering::Relaxed) {
                        continue;
                    }
                    if hub.active("cpu") {
                        sys.refresh_cpu_usage();
                        let cores: Vec<f32> = sys.cpus().iter().map(|c| c.usage()).collect();
                        let _ = app.emit("hub://cpu", json!({ "total": sys.global_cpu_usage(), "cores": cores }));
                    }
                    if hub.active("mem") {
                        sys.refresh_memory();
                        let _ = app.emit(
                            "hub://mem",
                            json!({
                                "used": sys.used_memory(), "total": sys.total_memory(),
                                "swapUsed": sys.used_swap(), "swapTotal": sys.total_swap(),
                            }),
                        );
                    }
                    if hub.active("net") {
                        if nets.is_none() { nets = Networks::new_with_refreshed_list().ok(); }
                        let Some(n) = nets.as_mut() else { continue };
                        n.refresh(true);
                        let secs = last_net.elapsed().as_secs_f64().max(0.001);
                        last_net = Instant::now();
                        let (rx, tx) = n.iter().fold((0u64, 0u64), |(r, t), (_, d)| (r + d.received(), t + d.transmitted()));
                        let _ = app.emit("hub://net", json!({ "rx": rx as f64 / secs, "tx": tx as f64 / secs }));
                    } else {
                        nets = None;
                    }
                    if hub.active("disk") && tick % 10 == 1 {
                        let Ok(disks) = Disks::new_with_refreshed_list() else { continue };
                        let list: Vec<_> = disks
                            .iter()
                            .map(|d| {
                                json!({
                                    "mount": d.mount_point().to_string_lossy(),
                                    "name": d.name().to_string_lossy(),
                                    "total": d.total_space(), "free": d.available_space(),
                                })
                            })
                            .collect();
                        let _ = app.emit("hub://disk", list);
                    }
                }
            })
            .ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refcounts_topics() {
        let hub = Hub::default();
        assert!(hub.subscribe("gpu").is_err());
        hub.subscribe("cpu").unwrap();
        hub.subscribe("cpu").unwrap();
        hub.unsubscribe("cpu");
        assert!(hub.active("cpu"));
        hub.unsubscribe("cpu");
        assert!(!hub.active("cpu"));
    }
}
