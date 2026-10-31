//! Now Playing (hub topic `media`): the session Windows shows in its media flyout (Global System
//! Media Transport Controls), so Spotify, browsers, players and games all work without plugins.
//! The hub emits only when something changed; the widget runs the progress bar itself from
//! `position` + `updated`. Cover art is fetched once per track and served by `media_art`.

use std::sync::Mutex;

use serde::Serialize;

#[derive(Serialize, PartialEq, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    /// Milliseconds; 0 when the app reports no timeline (most browsers).
    pub position: i64,
    pub duration: i64,
    /// Unix ms when `position` was true.
    pub updated: i64,
    pub can_prev: bool,
    pub can_next: bool,
    /// Changes whenever the cover changes; 0 = no cover.
    pub art: u64,
    pub art_type: String,
}

/// Latest cover: (id, mime type, bytes).
static ART: Mutex<(u64, String, Vec<u8>)> = Mutex::new((0, String::new(), Vec::new()));

#[tauri::command]
pub fn media_art() -> tauri::ipc::Response {
    tauri::ipc::Response::new(ART.lock().unwrap().2.clone())
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || imp::control(&action)).await.map_err(|e| e.to_string())?
}

/// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Spotify.exe", "MSEdge" → a readable name.
fn app_name(aumid: &str) -> String {
    let s = aumid.rsplit('!').next().unwrap_or(aumid);
    let s = s.strip_suffix(".exe").unwrap_or(s);
    let s = s.rsplit('\\').next().unwrap_or(s);
    match s.to_ascii_lowercase().as_str() {
        "msedge" => "Edge".into(),
        "chrome" => "Chrome".into(),
        // Firefox registers a hash of its install path.
        h if h.len() == 16 && h.chars().all(|c| c.is_ascii_hexdigit()) => "Firefox".into(),
        _ => s.to_owned(),
    }
}

pub use imp::Media;

#[cfg(windows)]
mod imp {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::{app_name, NowPlaying, ART};

    /// 100 ns ticks since 1601 → Unix ms.
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;

    fn mta() {
        // SAFETY: joins (or re-joins, S_FALSE) the multithreaded apartment for this thread.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    }

    #[derive(Default)]
    pub struct Media {
        manager: Option<Manager>,
        last: Option<NowPlaying>,
        track: String,
        art_tries: u8,
    }

    impl Media {
        pub fn new() -> Self {
            mta();
            Media::default()
        }

        /// The current state when it differs from the last call (or `force`), else `None`.
        /// `Some(None)` means nothing is playing any more.
        pub fn poll(&mut self, force: bool) -> Option<Option<NowPlaying>> {
            if self.manager.is_none() {
                self.manager = Manager::RequestAsync().and_then(|op| op.join()).ok();
            }
            let now = self.manager.as_ref().and_then(|m| m.GetCurrentSession().ok()).and_then(|s| self.read(&s));
            if !force && now == self.last {
                return None;
            }
            self.last = now.clone();
            Some(now)
        }

        fn read(&mut self, s: &Session) -> Option<NowPlaying> {
            let props = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
            let info = s.GetPlaybackInfo().ok()?;
            let controls = info.Controls().ok();
            let tl = s.GetTimelineProperties().ok();
            let aumid = s.SourceAppUserModelId().map(|a| a.to_string()).unwrap_or_default();
            let text = |r: windows::core::Result<windows::core::HSTRING>| r.map(|h| h.to_string()).unwrap_or_default();
            let mut np = NowPlaying {
                app: app_name(&aumid),
                title: text(props.Title()),
                artist: text(props.Artist()),
                album: text(props.AlbumTitle()),
                playing: info.PlaybackStatus().ok() == Some(Status::Playing),
                can_prev: controls.as_ref().and_then(|c| c.IsPreviousEnabled().ok()).unwrap_or(false),
                can_next: controls.as_ref().and_then(|c| c.IsNextEnabled().ok()).unwrap_or(false),
                ..Default::default()
            };
            if np.title.is_empty() {
                return None;
            }
            if let Some(tl) = tl {
                let ms = |t: windows::core::Result<windows::Foundation::TimeSpan>| t.map(|t| t.Duration / 10_000).unwrap_or(0);
                let start = ms(tl.StartTime());
                np.duration = (ms(tl.EndTime()) - start).max(0);
                np.position = (ms(tl.Position()) - start).clamp(0, np.duration);
                np.updated = tl.LastUpdatedTime().map(|d| (d.UniversalTime - EPOCH_DIFF) / 10_000).unwrap_or(0);
            }

            // Cover art: once per track, retried a few polls since apps often set it late.
            let track = format!("{aumid}\n{}\n{}\n{}", np.title, np.artist, np.album);
            if track != self.track {
                self.track = track;
                self.art_tries = 0;
                *ART.lock().unwrap() = (0, String::new(), Vec::new());
            }
            let mut art = ART.lock().unwrap();
            if art.0 == 0 && self.art_tries < 6 {
                self.art_tries += 1;
                if let Some((mime, bytes)) = thumbnail(&props) {
                    *art = (art_id(), mime, bytes);
                }
            }
            np.art = art.0;
            np.art_type = art.1.clone();
            Some(np)
        }
    }

    fn art_id() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(1);
        NEXT.fetch_add(1, Ordering::Relaxed)
    }

    fn thumbnail(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<(String, Vec<u8>)> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 || size > 8 << 20 {
            return None;
        }
        let mime = stream.ContentType().map(|m| m.to_string()).unwrap_or_default();
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size).ok()?.join().ok()?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some((if mime.is_empty() { "image/jpeg".into() } else { mime }, bytes))
    }

    pub fn control(action: &str) -> Result<(), String> {
        mta();
        let s = Manager::RequestAsync()
            .and_then(|op| op.join())
            .and_then(|m| m.GetCurrentSession())
            .map_err(|e| e.message())?;
        let op = match action {
            "toggle" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "prev" => s.TrySkipPreviousAsync(),
            _ => return Err(format!("unknown action {action}")),
        };
        op.and_then(|op| op.join()).map(|_| ()).map_err(|e| e.message())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::NowPlaying;

    #[derive(Default)]
    pub struct Media;

    impl Media {
        pub fn new() -> Self {
            Media
        }
        pub fn poll(&mut self, _force: bool) -> Option<Option<NowPlaying>> {
            None
        }
    }

    pub fn control(_action: &str) -> Result<(), String> {
        Err("not supported".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_apps() {
        assert_eq!(app_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Spotify");
        assert_eq!(app_name("Spotify.exe"), "Spotify");
        assert_eq!(app_name("MSEdge"), "Edge");
        assert_eq!(app_name("308046B0AF4A39CB"), "Firefox");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "reads what this machine is playing"]
    fn live_media() {
        let mut m = Media::new();
        println!("{:?}", m.poll(true));
    }
}
