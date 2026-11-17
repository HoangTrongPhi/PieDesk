//! Coding-agent sessions (Claude Code, Antigravity) for the Agents widget.
//!
//! Claude Code appends one JSON line per event to `~/.claude/projects/<project>/<session>.jsonl`;
//! each file is read incrementally from where the previous scan stopped, so a scan only parses
//! the lines written since. Antigravity keeps one summary row per conversation in
//! `~/.gemini/antigravity/conversation_summaries.db` (SQLite, opened read-only).
//! Scans run on the hub thread, only while a widget subscribes to the `agents` topic.
//!
//! Plan usage: when Claude hits a usage limit, the transcript gets a synthetic assistant line with
//! `apiError: "usage_limit_reached"` and `quotaLimits { rateLimitType, resetsAt }`. Those limits
//! are remembered (also across restarts, in `%APPDATA%\PieDesk\agent-limits.json`) and reported
//! once more when their reset time passes, so the widget can say "usage has reset".

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A working session with no new event for this long is shown as "waiting" (permission prompt,
/// or a long tool call); after `STALE_MS` it is dropped.
const WAITING_MS: u64 = 120_000;
const STALE_MS: u64 = 30 * 60_000;
/// Finished sessions stay listed this long.
const KEEP_DONE_MS: u64 = 6 * 3_600_000;
/// First read of a large transcript only looks at its tail.
const MAX_FIRST_READ: u64 = 4 << 20;
const IDLE: &str = "CASCADE_RUN_STATUS_IDLE";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Working,
    Waiting,
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub source: &'static str,
    pub title: String,
    pub project: String,
    pub state: State,
    /// Last activity, unix ms.
    pub updated: u64,
}

#[derive(Default)]
struct ClaudeFile {
    offset: u64,
    title: Option<String>,
    agent_name: Option<String>,
    prompt: Option<String>,
    cwd: Option<String>,
    working: bool,
    /// Usage limits hit in this file since the last scan.
    limits: Vec<Limit>,
}

/// A Claude usage limit that was hit: `kind` is `five_hour`, `seven_day`, `seven_day_opus`...
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub kind: String,
    /// Unix ms.
    pub resets_at: u64,
    pub hit_at: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// "Pro", "Max", "Team"... from `~/.claude.json` (empty when unknown).
    pub plan: String,
    /// Limits in force right now.
    pub limits: Vec<Limit>,
    /// Limits whose reset time just passed (reported once).
    pub reset: Vec<Limit>,
}

#[derive(Default, Serialize, Deserialize)]
struct LimitStore {
    active: Vec<Limit>,
    /// (kind, resetsAt) already reported, so a re-read transcript does not report them again.
    announced: Vec<(String, u64)>,
}

/// A reset that passed while PieDesk was not running is still reported if it is this recent.
const RESET_GRACE_MS: u64 = 3 * 3_600_000;

#[derive(Default)]
pub struct Agents {
    claude: HashMap<PathBuf, ClaudeFile>,
    last: HashMap<String, State>,
    primed: bool,
    limits: Option<LimitStore>,
    plan: Option<(String, u64)>,
}

impl Agents {
    /// Current sessions (busiest and newest first) and the ids that finished since the last scan.
    pub fn scan(&mut self) -> (Vec<Session>, Vec<String>) {
        let now = now_ms();
        let mut sessions = Vec::new();
        if let Some(home) = home() {
            self.scan_claude(&claude_root(&home), now, &mut sessions);
            for dir in ["antigravity", "antigravity-ide"] {
                scan_antigravity(&home.join(".gemini").join(dir), now, &mut sessions);
            }
        }
        sessions.sort_by(|a, b| (a.state == State::Done).cmp(&(b.state == State::Done)).then(b.updated.cmp(&a.updated)));

        let finished = if self.primed {
            sessions
                .iter()
                .filter(|s| s.state == State::Done && matches!(self.last.get(&s.id), Some(State::Working | State::Waiting)))
                .map(|s| s.id.clone())
                .collect()
        } else {
            Vec::new()
        };
        self.last = sessions.iter().map(|s| (s.id.clone(), s.state)).collect();
        self.primed = true;
        (sessions, finished)
    }

    /// Plan usage: limits in force and the ones that just reset. Call after [`Agents::scan`].
    pub fn usage(&mut self) -> Usage {
        let now = now_ms();
        let store = self.limits.get_or_insert_with(load_limits);
        let mut changed = false;
        let mut reset = Vec::new();
        // Collect what the transcripts reported since the last call.
        for f in self.claude.values_mut() {
            for l in f.limits.drain(..) {
                if store.announced.iter().any(|(k, r)| *k == l.kind && *r == l.resets_at) {
                    continue;
                }
                match store.active.iter_mut().find(|a| a.kind == l.kind) {
                    Some(a) if a.resets_at >= l.resets_at => {}
                    Some(a) => {
                        *a = l;
                        changed = true;
                    }
                    None => {
                        store.active.push(l);
                        changed = true;
                    }
                }
            }
        }
        store.active.retain(|l| {
            if now < l.resets_at {
                return true;
            }
            if now - l.resets_at < RESET_GRACE_MS {
                reset.push(l.clone());
            }
            store.announced.push((l.kind.clone(), l.resets_at));
            changed = true;
            false
        });
        if changed {
            store.announced.retain(|(_, r)| now.saturating_sub(*r) < 8 * 24 * 3_600_000);
            save_limits(store);
        }
        // The plan rarely changes: read it every 10 minutes.
        if self.plan.as_ref().is_none_or(|(_, t)| now.saturating_sub(*t) > 600_000) {
            self.plan = Some((home().map(|h| read_plan(&h)).unwrap_or_default(), now));
        }
        let mut limits = store.active.clone();
        limits.sort_by_key(|l| l.resets_at);
        Usage { plan: self.plan.as_ref().map(|p| p.0.clone()).unwrap_or_default(), limits, reset }
    }

    fn scan_claude(&mut self, root: &Path, now: u64, out: &mut Vec<Session>) {
        let Ok(projects) = fs::read_dir(root) else { return };
        let mut seen = Vec::new();
        for project in projects.flatten() {
            let Ok(files) = fs::read_dir(project.path()) else { continue };
            for file in files.flatten() {
                let path = file.path();
                if path.extension().is_none_or(|e| e != "jsonl") {
                    continue;
                }
                let Ok(meta) = file.metadata() else { continue };
                let mtime = meta.modified().map(ms).unwrap_or(0);
                if now.saturating_sub(mtime) > KEEP_DONE_MS {
                    continue;
                }
                seen.push(path.clone());
                let entry = self.claude.entry(path.clone()).or_default();
                read_new_lines(&path, meta.len(), entry);

                let age = now.saturating_sub(mtime);
                let state = match (entry.working, age) {
                    (true, a) if a < WAITING_MS => State::Working,
                    (true, a) if a < STALE_MS => State::Waiting,
                    (true, _) => continue,
                    (false, _) => State::Done,
                };
                let project_name = entry
                    .cwd
                    .as_deref()
                    .map(base_name)
                    .unwrap_or_else(|| project.file_name().to_string_lossy().into_owned());
                let title = entry
                    .title
                    .clone()
                    .or_else(|| entry.agent_name.clone())
                    .or_else(|| entry.prompt.as_deref().map(|p| truncate(p, 80)))
                    .unwrap_or_else(|| project_name.clone());
                let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                out.push(Session {
                    id: format!("claude:{stem}"),
                    source: "claude",
                    title,
                    project: project_name,
                    state,
                    updated: mtime,
                });
            }
        }
        self.claude.retain(|p, _| seen.contains(p));
    }
}

/// Parses the complete lines appended since `entry.offset`.
fn read_new_lines(path: &Path, len: u64, entry: &mut ClaudeFile) {
    if len < entry.offset {
        *entry = ClaudeFile::default(); // rewritten
    }
    if len == entry.offset {
        return;
    }
    let Ok(mut f) = File::open(path) else { return };
    let start = if entry.offset == 0 && len > MAX_FIRST_READ { len - MAX_FIRST_READ } else { entry.offset };
    if f.seek(SeekFrom::Start(start)).is_err() {
        return;
    }
    let mut buf = Vec::with_capacity((len - start) as usize);
    if f.take(len - start).read_to_end(&mut buf).is_err() {
        return;
    }
    let Some(end) = buf.iter().rposition(|&b| b == b'\n') else { return };
    let mut chunk = &buf[..=end];
    if start != entry.offset {
        // Started mid-file: skip the partial first line.
        let first = chunk.iter().position(|&b| b == b'\n').unwrap_or(0);
        chunk = &chunk[first + 1..];
    }
    for line in chunk.split(|&b| b == b'\n') {
        if let Ok(v) = serde_json::from_slice::<Value>(line) {
            apply_claude_line(entry, &v);
        }
    }
    entry.offset = start + end as u64 + 1;
}

fn apply_claude_line(f: &mut ClaudeFile, v: &Value) {
    let text = |key: &str| v.get(key).and_then(Value::as_str).map(str::to_owned);
    if let Some(l) = limit_of(v) {
        f.limits.push(l);
    }
    if let Some(cwd) = text("cwd") {
        f.cwd = Some(cwd);
    }
    // Subagent traffic lives in the same file but does not change the main session's turn.
    let main = !v.get("isSidechain").and_then(Value::as_bool).unwrap_or(false);
    match v.get("type").and_then(Value::as_str) {
        Some("custom-title") => f.title = text("customTitle").filter(|t| !t.is_empty()),
        Some("agent-name") => f.agent_name = text("agentName").filter(|t| !t.is_empty()),
        Some("last-prompt") => f.prompt = text("lastPrompt"),
        Some("user") if main && !v.get("isMeta").and_then(Value::as_bool).unwrap_or(false) => {
            let content = &v["message"]["content"];
            let first_text = match content {
                Value::String(s) => Some(s.as_str()),
                Value::Array(parts) => parts.iter().find_map(|p| p.get("text").and_then(Value::as_str)),
                _ => None,
            };
            match first_text {
                Some(t) if t.starts_with("[Request interrupted") => f.working = false,
                // Slash commands run locally and get no assistant turn.
                Some(t) if t.starts_with("<command-") || t.starts_with("<local-command") => {}
                _ => f.working = true,
            }
        }
        Some("assistant") if main => {
            let stop = v["message"]["stop_reason"].as_str();
            f.working = !matches!(stop, Some("end_turn" | "stop_sequence" | "max_tokens" | "refusal"));
        }
        Some("system") if main => {
            if matches!(v.get("subtype").and_then(Value::as_str), Some("stop_hook_summary" | "turn_duration")) {
                f.working = false;
            }
        }
        _ => {}
    }
}

/// A "usage limit reached" line -> the limit and when it resets.
fn limit_of(v: &Value) -> Option<Limit> {
    let q = v.get("quotaLimits").filter(|q| q.is_object()).or_else(|| v.pointer("/apiErrorParams/rate_limit_info"))?;
    let rejected = q.get("status").and_then(Value::as_str) == Some("rejected")
        || v.get("apiError").and_then(Value::as_str) == Some("usage_limit_reached");
    if !rejected {
        return None;
    }
    let resets = q.get("resetsAt").and_then(Value::as_u64)?;
    // Seconds, but accept milliseconds too.
    let resets_at = if resets < 100_000_000_000 { resets * 1000 } else { resets };
    let kind = q.get("rateLimitType").and_then(Value::as_str).unwrap_or("five_hour").to_owned();
    let hit_at = v.get("timestamp").and_then(Value::as_str).and_then(parse_iso).unwrap_or_else(now_ms);
    Some(Limit { kind, resets_at, hit_at })
}

/// `2026-10-31T16:16:01.009Z` -> unix ms.
fn parse_iso(s: &str) -> Option<u64> {
    parse_time(&s.replacen('T', " ", 1).replace('Z', "+00:00"))
}

/// The Claude subscription, from `~/.claude.json` (`oauthAccount.organizationType: "claude_pro"`).
fn read_plan(home: &Path) -> String {
    let path = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(|d| PathBuf::from(d).join(".claude.json"))
        .unwrap_or_else(|| home.join(".claude.json"));
    let Ok(text) = fs::read_to_string(path) else { return String::new() };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return String::new() };
    let acct = &v["oauthAccount"];
    let raw = acct["subscriptionType"].as_str().filter(|s| !s.is_empty()).or_else(|| acct["organizationType"].as_str()).unwrap_or("");
    plan_label(raw)
}

fn plan_label(raw: &str) -> String {
    let t = raw.trim_start_matches("claude_").to_lowercase();
    match t.as_str() {
        "" => String::new(),
        "pro" => "Pro".into(),
        "max" => "Max".into(),
        "team" => "Team".into(),
        "enterprise" => "Enterprise".into(),
        "free" => "Free".into(),
        other => {
            let mut c = other.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        }
    }
}

/// "5 gio" / "5-hour", "tuan" / "weekly"...
pub fn limit_name(kind: &str, vi: bool) -> &'static str {
    let weekly = kind.starts_with("seven_day");
    let opus = kind.contains("opus");
    match (weekly, opus, kind == "five_hour", vi) {
        (_, _, true, true) => "5 giờ",
        (_, _, true, false) => "5-hour",
        (true, true, _, true) => "tuần (Opus)",
        (true, true, _, false) => "weekly Opus",
        (true, false, _, true) => "tuần",
        (true, false, _, false) => "weekly",
        (_, _, _, true) => "phiên",
        _ => "session",
    }
}

fn limits_path() -> Option<PathBuf> {
    if cfg!(test) {
        return None; // tests must not touch the real store
    }
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("PieDesk").join("agent-limits.json"))
}

fn load_limits() -> LimitStore {
    limits_path().and_then(|p| fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_limits(store: &LimitStore) {
    if let Some(p) = limits_path() {
        if let Some(dir) = p.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(b) = serde_json::to_vec(store) {
            let _ = fs::write(p, b);
        }
    }
}

fn scan_antigravity(root: &Path, now: u64, out: &mut Vec<Session>) {
    use rusqlite::{Connection, OpenFlags};
    let db = root.join("conversation_summaries.db");
    if !db.exists() {
        return;
    }
    let Ok(conn) = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) else {
        return;
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(200));
    let Ok(mut stmt) = conn.prepare(
        "SELECT conversation_id, title, preview, workspace_uris, status, last_modified_time, not_fully_idle, killed
         FROM conversation_summaries WHERE nesting_depth = 0 ORDER BY last_modified_time DESC LIMIT 20",
    ) else {
        return;
    };
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, bool>(6).unwrap_or(false),
            r.get::<_, bool>(7).unwrap_or(false),
        ))
    });
    let Ok(rows) = rows else { return };
    for (id, title, preview, workspaces, status, modified, not_idle, killed) in rows.flatten() {
        // The conversation's own database is written on every step, often before the summary.
        let conv = root.join("conversations").join(format!("{id}.db"));
        let touched = [conv.clone(), conv.with_extension("db-wal")]
            .iter()
            .filter_map(|p| fs::metadata(p).and_then(|m| m.modified()).ok().map(ms))
            .max()
            .unwrap_or(0);
        let updated = parse_time(&modified).unwrap_or(0).max(touched);
        let age = now.saturating_sub(updated);
        let busy = !killed && (status != IDLE || not_idle || now.saturating_sub(touched) < 15_000);
        let state = match (busy, age) {
            (true, a) if a < WAITING_MS => State::Working,
            (true, a) if a < STALE_MS => State::Waiting,
            (true, _) => continue,
            (false, a) if a < KEEP_DONE_MS => State::Done,
            (false, _) => continue,
        };
        let project = serde_json::from_str::<Vec<String>>(&workspaces)
            .ok()
            .and_then(|w| w.into_iter().next())
            .map(|uri| base_name(&percent_encoding::percent_decode_str(&uri).decode_utf8_lossy()))
            .unwrap_or_default();
        let title = if title.is_empty() { truncate(&preview, 80) } else { title };
        out.push(Session { id: format!("antigravity:{id}"), source: "antigravity", title, project, state, updated });
    }
}

fn claude_root(home: &Path) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude")).join("projects")
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

fn now_ms() -> u64 {
    ms(SystemTime::now())
}

fn ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn base_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or(path).to_owned()
}

fn truncate(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    match s.char_indices().nth(n) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s,
    }
}

/// `2026-10-26 19:14:21.3675157+00:00` (Go's time format in SQLite) → unix ms.
fn parse_time(s: &str) -> Option<u64> {
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let tz = s.rfind(['+', '-']).filter(|&i| i > 19).map_or(0, |i| {
        let sign = if &s[i..=i] == "-" { -1 } else { 1 };
        let hh = s.get(i + 1..i + 3).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
        let mm = s.get(i + 4..i + 6).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
        sign * (hh * 3600 + mm * 60)
    });
    // Days from civil (Howard Hinnant).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((mo + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + h * 3600 + mi * 60 + sec - tz;
    u64::try_from(secs).ok().map(|s| s * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_usage_limits() {
        let line = serde_json::from_str::<Value>(
            r#"{"type":"assistant","timestamp":"2026-10-31T16:16:01.009Z","apiError":"usage_limit_reached","quotaLimits":{"status":"rejected","resetsAt":1793470200,"rateLimitType":"five_hour"},"message":{"stop_reason":"stop_sequence"}}"#,
        )
        .unwrap();
        let l = limit_of(&line).unwrap();
        assert_eq!(l.kind, "five_hour");
        assert_eq!(l.resets_at, 1_793_470_200_000);
        assert_eq!(l.hit_at, parse_time("2026-10-31 16:16:01+00:00").unwrap());
        let ok = serde_json::from_str::<Value>(r#"{"type":"assistant","quotaLimits":{"status":"allowed","resetsAt":1}}"#).unwrap();
        assert!(limit_of(&ok).is_none());
        assert_eq!(plan_label("claude_pro"), "Pro");
        assert_eq!(plan_label("claude_max"), "Max");
        assert_eq!(limit_name("seven_day_opus", false), "weekly Opus");
    }

    #[test]
    fn reports_a_reset_once() {
        let mut a = Agents { limits: Some(LimitStore::default()), plan: Some(("Pro".into(), u64::MAX / 2)), ..Default::default() };
        let now = now_ms();
        let mut f = ClaudeFile::default();
        f.limits.push(Limit { kind: "five_hour".into(), resets_at: now + 60_000, hit_at: now });
        a.claude.insert(PathBuf::from("x"), f);
        let u = a.usage();
        assert_eq!((u.limits.len(), u.reset.len()), (1, 0));
        a.limits.as_mut().unwrap().active[0].resets_at = now - 1000;
        let u = a.usage();
        assert_eq!((u.limits.len(), u.reset.len()), (0, 1));
        assert_eq!(a.usage().reset.len(), 0);
    }

    #[test]
    fn parses_go_sqlite_time() {
        assert_eq!(parse_time("1970-01-02 00:00:00.5+00:00"), Some(86_400_000));
        assert_eq!(parse_time("2026-10-26 19:14:21.3675157+07:00"), parse_time("2026-10-26 12:14:21+00:00"));
    }

    #[test]
    fn follows_claude_turns() {
        let mut f = ClaudeFile::default();
        let line = |s: &str| serde_json::from_str::<Value>(s).unwrap();
        apply_claude_line(&mut f, &line(r#"{"type":"custom-title","customTitle":"Fix bug"}"#));
        apply_claude_line(&mut f, &line(r#"{"type":"user","cwd":"P:\\x\\proj","message":{"content":"hi"}}"#));
        assert!(f.working);
        apply_claude_line(&mut f, &line(r#"{"type":"assistant","message":{"stop_reason":"tool_use"}}"#));
        assert!(f.working);
        apply_claude_line(&mut f, &line(r#"{"type":"assistant","isSidechain":true,"message":{"stop_reason":"end_turn"}}"#));
        assert!(f.working);
        apply_claude_line(&mut f, &line(r#"{"type":"assistant","message":{"stop_reason":"end_turn"}}"#));
        assert!(!f.working);
        assert_eq!(f.title.as_deref(), Some("Fix bug"));
        assert_eq!(base_name(f.cwd.as_deref().unwrap()), "proj");
    }

    /// `cargo test live_scan -- --ignored --nocapture` prints this machine's sessions.
    #[test]
    #[ignore]
    fn live_scan() {
        let (sessions, _) = Agents::default().scan();
        for s in sessions {
            println!("{:?} {:<11} {:<20} {}", s.state, s.source, s.project, s.title);
        }
    }

    #[test]
    fn reads_only_appended_lines() {
        let dir = std::env::temp_dir().join(format!("piedesk-agents-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        fs::write(&path, "{\"type\":\"user\",\"message\":{\"content\":\"go\"}}\n{\"type\":\"assist").unwrap();
        let mut f = ClaudeFile::default();
        read_new_lines(&path, fs::metadata(&path).unwrap().len(), &mut f);
        assert!(f.working);
        let partial = f.offset;
        fs::write(&path, "{\"type\":\"user\",\"message\":{\"content\":\"go\"}}\n{\"type\":\"assistant\",\"message\":{\"stop_reason\":\"end_turn\"}}\n").unwrap();
        read_new_lines(&path, fs::metadata(&path).unwrap().len(), &mut f);
        assert!(!f.working);
        assert!(f.offset > partial);
        let _ = fs::remove_dir_all(dir);
    }
}
