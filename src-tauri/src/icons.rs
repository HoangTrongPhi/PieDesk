//! `icon://` protocol: shell icons (and optional thumbnails) as PNG.
//!
//! URL: `http://icon.localhost/<percent-encoded path>?s=<size>&t=<0|1>`.
//! Extraction runs on a small pool of COM (STA) worker threads; results are cached in memory and
//! on disk keyed by xxh3(path, mtime, len, size, thumb), so a cold start only re-encodes what changed.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response, StatusCode};
use tauri::UriSchemeResponder;
use xxhash_rust::xxh3::xxh3_64;

const WORKERS: usize = 3;
const MEM_CAP: usize = 768;

type Job = (String, u32, bool, UriSchemeResponder);

#[derive(Clone)]
pub struct IconService {
    tx: Sender<Job>,
}

struct Cache {
    dir: PathBuf,
    mem: Mutex<HashMap<u64, Arc<Vec<u8>>>>,
}

impl IconService {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&cache_dir);
        let cache = Arc::new(Cache { dir: cache_dir, mem: Mutex::new(HashMap::new()) });
        let (tx, rx) = channel::<Job>();
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..WORKERS {
            let rx = rx.clone();
            let cache = cache.clone();
            std::thread::Builder::new()
                .name(format!("icon-{i}"))
                .spawn(move || {
                    com_init();
                    loop {
                        let job = rx.lock().unwrap().recv();
                        let Ok((path, size, thumb, responder)) = job else { break };
                        responder.respond(serve(&cache, &path, size, thumb));
                    }
                })
                .ok();
        }
        IconService { tx }
    }

    pub fn handle(&self, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
        let uri = request.uri();
        let path = percent_decode_str(uri.path().trim_start_matches('/')).decode_utf8_lossy().into_owned();
        let mut size = 48u32;
        let mut thumb = false;
        for pair in uri.query().unwrap_or("").split('&') {
            match pair.split_once('=') {
                Some(("s", v)) => size = v.parse().unwrap_or(48).clamp(16, 256),
                Some(("t", v)) => thumb = v == "1",
                _ => {}
            }
        }
        if path.is_empty() {
            responder.respond(not_found());
            return;
        }
        let _ = self.tx.send((path, size, thumb, responder));
    }
}

fn serve(cache: &Cache, path: &str, size: u32, thumb: bool) -> Response<Vec<u8>> {
    let key = cache_key(path, size, thumb);
    if let Some(png) = cache.mem.lock().unwrap().get(&key).cloned() {
        return png_response(png.to_vec());
    }
    let disk = cache.dir.join(format!("{key:016x}.png"));
    let png = match fs::read(&disk) {
        Ok(bytes) => bytes,
        Err(_) => match extract(path, size, thumb) {
            Some(bytes) => {
                let _ = fs::write(&disk, &bytes);
                bytes
            }
            None => return not_found(),
        },
    };
    let mut mem = cache.mem.lock().unwrap();
    if mem.len() >= MEM_CAP {
        mem.clear();
    }
    mem.insert(key, Arc::new(png.clone()));
    png_response(png)
}

fn cache_key(path: &str, size: u32, thumb: bool) -> u64 {
    let (mtime, len) = fs::metadata(Path::new(path))
        .map(|m| {
            let t = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
            (t, m.len())
        })
        .unwrap_or((0, 0));
    xxh3_64(format!("{}|{mtime}|{len}|{size}|{thumb}", path.to_lowercase()).as_bytes())
}

fn png_response(body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header("Content-Type", "image/png")
        .header("Cache-Control", "max-age=600")
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap()
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap()
}

/// Straight RGBA → PNG.
fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}

/// BGRA (possibly premultiplied, possibly without alpha) → straight RGBA, in place.
fn bgra_to_rgba(px: &mut [u8]) {
    let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
    let premultiplied = has_alpha && px.chunks_exact(4).all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]);
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
        if !has_alpha {
            p[3] = 255;
        } else if premultiplied && p[3] > 0 && p[3] < 255 {
            let a = p[3] as u32;
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
}

#[cfg(windows)]
fn com_init() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    }
}

#[cfg(not(windows))]
fn com_init() {}

#[cfg(windows)]
fn extract(path: &str, size: u32, thumb: bool) -> Option<Vec<u8>> {
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY, SIIGBF_RESIZETOFIT,
    };

    unsafe {
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(path), None).ok()?;
        let flags = if thumb { SIIGBF_RESIZETOFIT } else { SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK };
        let hbmp = factory.GetImage(SIZE { cx: size as i32, cy: size as i32 }, flags).ok()?;
        let obj = HGDIOBJ(hbmp.0);

        let mut bm = BITMAP::default();
        let got = GetObjectW(obj, size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void));
        if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
            let _ = DeleteObject(obj);
            return None;
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let hdc = GetDC(None);
        let lines = GetDIBits(hdc, hbmp, 0, h as u32, Some(px.as_mut_ptr() as *mut c_void), &mut info, DIB_RGB_COLORS);
        ReleaseDC(None, hdc);
        let _ = DeleteObject(obj);
        if lines == 0 {
            return None;
        }
        bgra_to_rgba(&mut px);
        encode_png(w as u32, h as u32, &px)
    }
}

#[cfg(not(windows))]
fn extract(_path: &str, _size: u32, _thumb: bool) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpremultiplies_and_swaps() {
        // Premultiplied BGRA: blue=0, green=0, red=64 at alpha 128 → straight red ≈ 128.
        let mut px = vec![0, 0, 64, 128, 0, 0, 0, 0];
        bgra_to_rgba(&mut px);
        assert_eq!(&px[..4], &[128, 0, 0, 128]);
    }

    #[test]
    fn opaque_when_no_alpha() {
        let mut px = vec![10, 20, 30, 0];
        bgra_to_rgba(&mut px);
        assert_eq!(px, vec![30, 20, 10, 255]);
    }

    #[cfg(windows)]
    #[test]
    fn extracts_a_real_shell_icon() {
        com_init();
        let png = extract(r"C:\Windows\System32\notepad.exe", 48, false).expect("icon");
        assert_eq!(&png[1..4], b"PNG");
    }

    #[test]
    fn key_changes_with_size() {
        assert_ne!(cache_key("C:/x.lnk", 32, false), cache_key("C:/x.lnk", 64, false));
    }
}
