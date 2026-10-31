//! PieDesk — desktop boxes & widgets.
//!
//! One transparent surface window per monitor holds every box and widget of that monitor; see
//! `docs/ARCHITECTURE.md` for why. The manager window (tray → Settings) edits global settings
//! and hosts the widget gallery.

mod agents;
mod apps;
mod catalog;
mod desktop;
mod folders;
mod gpu;
mod guard;
mod hittest;
mod hub;
mod icons;
mod items;
mod media;
mod monitors;
mod overlays;
mod shell;
mod startup;
mod store;
mod surfaces;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use folders::Watches;
use hittest::HitTest;
use hub::Hub;
use icons::IconService;
use store::{Op, Store};
use surfaces::SurfaceInfo;

pub const SURFACE_PREFIX: &str = "surface-";
const MANAGER: &str = "manager";
const DEFAULT_HOTKEY: &str = "Alt+Shift+D";

pub struct AppState {
    pub store: Store,
    pub hit: HitTest,
    pub hub: Hub,
    pub icons: IconService,
    pub watches: Watches,
    pub user_hidden: AtomicBool,
    pub surfaces: Mutex<HashMap<String, SurfaceInfo>>,
    pub hotkey: Mutex<Option<String>>,
    /// Newer version found by the background check (shown in the tray).
    pub update: Mutex<Option<String>>,
    /// Shortcuts owned by box items (`items.rs`).
    pub items_dir: std::path::PathBuf,
}

// ---------------------------------------------------------------------------------------------
// Commands

#[tauri::command]
fn surface_info(window: WebviewWindow, state: tauri::State<AppState>) -> Option<SurfaceInfo> {
    state.surfaces.lock().unwrap().get(window.label()).cloned()
}

#[tauri::command]
fn store_get(state: tauri::State<AppState>) -> store::Doc {
    state.store.snapshot()
}

#[derive(Clone, Serialize)]
pub(crate) struct OpsEvent<'a> {
    pub origin: &'a str,
    pub rev: u64,
    pub ops: &'a [Op],
}

#[tauri::command]
fn store_apply(app: AppHandle, window: WebviewWindow, state: tauri::State<AppState>, ops: Vec<Op>) -> u64 {
    let rev = state.store.apply(&ops);
    let _ = app.emit("store://ops", OpsEvent { origin: window.label(), rev, ops: &ops });
    let touched = |key: &str| ops.iter().any(|op| matches!(op, Op::Settings { value } if value.get(key).is_some()));
    if touched("hotkey") {
        register_hotkey(&app);
    }
    if touched("homeMonitor") {
        surfaces::poke();
    }
    if touched("overlayFx") || touched("pet") {
        overlays::sync_later(&app);
    }
    if ["language", "locked", "party"].iter().any(|k| touched(k)) {
        refresh_tray(&app);
    }
    rev
}

/// Writes pending changes now: the updater quits the app to run the installer.
#[tauri::command]
fn store_flush(state: tauri::State<AppState>) {
    state.store.flush();
}

#[tauri::command]
fn hit_rects(window: WebviewWindow, state: tauri::State<AppState>, rects: Vec<[f64; 4]>) {
    state.hit.update(window.label(), |s| s.rects = rects);
    state.hit.invalidate(window.label());
}

#[tauri::command]
fn hit_capture(window: WebviewWindow, state: tauri::State<AppState>, capture: bool) {
    state.hit.update(window.label(), |s| s.capture = capture);
    state.hit.invalidate(window.label());
    if capture {
        // Capturing means the user is typing or dragging here: let the surface take keyboard focus.
        let _ = window.set_ignore_cursor_events(false);
    }
}

#[tauri::command]
fn open_path(path: String, admin: Option<bool>) -> Result<(), String> {
    shell::open(&path, admin.unwrap_or(false))
}

/// Takes a dropped / picked path into a box (moves shortcuts in, links anything else).
/// Async: runs off the main thread (COM).
#[tauri::command]
async fn import_item(state: tauri::State<'_, AppState>, path: String) -> Result<items::Imported, String> {
    items::import(&state.items_dir, &path)
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    startup::is_enabled(&app)
}

#[tauri::command]
fn autostart_set(app: AppHandle, on: bool) -> bool {
    startup::set(&app, on)
}

/// Puts a shortcut for every installed program that is in no box yet onto the desktop.
#[tauri::command]
async fn gather_apps(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<apps::Gathered, String> {
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    let taken: Vec<String> = state.store.read(|d| {
        d.boxes
            .values()
            .flat_map(|b| b.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default())
            .filter_map(|i| i.get("path").and_then(|p| p.as_str()).map(str::to_owned))
            .collect()
    });
    Ok(apps::gather(&apps::start_menu_dirs(), &desktop, &taken))
}

/// Installed programs with no shortcut in a box yet, sorted into groups.
#[tauri::command]
async fn app_catalog(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    overrides: HashMap<String, String>,
) -> Result<catalog::Catalog, String> {
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let taken: std::collections::HashSet<String> = state.store.read(|d| {
        d.boxes
            .values()
            .flat_map(|b| b.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default())
            .flat_map(|i| ["path", "source"].map(|k| i.get(k).and_then(|p| p.as_str()).map(str::to_owned)))
            .flatten()
            .map(|p| items::target_key(std::path::Path::new(&p)))
            .collect()
    });
    Ok(catalog::scan(&catalog::Rules::load(&config), &apps::start_menu_dirs(), &desktop, &taken, &overrides))
}

/// Puts a program's shortcut into a box: a desktop one moves in, a Start Menu one is copied.
#[tauri::command]
async fn take_app(state: tauri::State<'_, AppState>, link: String, on_desktop: bool) -> Result<items::Imported, String> {
    if on_desktop {
        items::import(&state.items_dir, &link)
    } else {
        items::copy_in(&state.items_dir, &link)
    }
}

/// Takes an item out of a box, putting a moved shortcut back where it came from.
#[tauri::command]
fn remove_item(app: AppHandle, state: tauri::State<AppState>, path: String, source: Option<String>, origin: Option<items::Origin>) {
    let fallback = app.path().desktop_dir().unwrap_or_else(|_| state.items_dir.clone());
    items::release(&state.items_dir, &path, source.as_deref(), origin, &fallback)
}

/// Older items still have their original on the desktop: move it into the box now.
#[tauri::command]
fn claim_item(state: tauri::State<AppState>, path: String, source: String) -> items::Origin {
    items::claim(&state.items_dir, &path, &source)
}

#[tauri::command]
fn is_owned_item(state: tauri::State<AppState>, path: String) -> bool {
    items::is_owned(&state.items_dir, &path)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    shell::reveal(&path)
}

#[tauri::command]
fn list_folder(path: String) -> Result<Vec<folders::Entry>, String> {
    folders::list(&path)
}

#[tauri::command]
fn watch_folder(app: AppHandle, state: tauri::State<AppState>, path: String) -> Result<(), String> {
    state.watches.watch(&app, &path)
}

#[tauri::command]
fn unwatch_folder(state: tauri::State<AppState>, path: String) {
    state.watches.unwatch(&path)
}

#[tauri::command]
fn hub_subscribe(state: tauri::State<AppState>, topic: String) -> Result<(), String> {
    state.hub.subscribe(&topic)
}

#[tauri::command]
fn hub_unsubscribe(state: tauri::State<AppState>, topic: String) {
    state.hub.unsubscribe(&topic)
}

#[tauri::command]
fn open_manager(app: AppHandle, tab: Option<String>) {
    show_manager(&app, tab.as_deref());
}

#[tauri::command]
fn toggle_surfaces(app: AppHandle) {
    toggle_visibility(&app);
}

// ---------------------------------------------------------------------------------------------
// Windows

fn surface_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows().into_iter().filter(|(l, _)| l.starts_with(SURFACE_PREFIX)).map(|(_, w)| w).collect()
}

/// Shows or hides the surfaces and the overlay windows.
pub fn set_surfaces_visible(app: &AppHandle, visible: bool) {
    let all = app.webview_windows();
    for w in all.into_iter().filter(|(l, _)| l.starts_with(SURFACE_PREFIX) || l.starts_with(overlays::PREFIX)).map(|(_, w)| w) {
        let _ = if visible { w.show() } else { w.hide() };
    }
}

fn toggle_visibility(app: &AppHandle) {
    let state = app.state::<AppState>();
    let hidden = !state.user_hidden.load(Ordering::Relaxed);
    state.user_hidden.store(hidden, Ordering::Relaxed);
    set_surfaces_visible(app, !hidden);
    for w in surface_windows(app) {
        state.hit.update(w.label(), |s| s.hidden = hidden);
        state.hit.invalidate(w.label());
    }
}

fn show_manager(app: &AppHandle, tab: Option<&str>) {
    if let Some(w) = app.get_webview_window(MANAGER) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(tab) = tab {
            let _ = w.emit("manager://tab", tab);
        }
        return;
    }
    let url = match tab {
        Some(tab) => format!("index.html?view=manager&tab={tab}"),
        None => "index.html?view=manager".into(),
    };
    let _ = WebviewWindowBuilder::new(app, MANAGER, WebviewUrl::App(url.into()))
        .title("PieDesk")
        .inner_size(1000.0, 700.0)
        .min_inner_size(760.0, 520.0)
        .center()
        .background_color(tauri::window::Color(16, 18, 26, 255))
        .build();
}

// ---------------------------------------------------------------------------------------------
// Tray & hotkey

/// UI language stored by the frontend (`vi` or `en`).
fn lang(app: &AppHandle) -> String {
    app.state::<AppState>().store.read(|d| d.setting_str("language")).unwrap_or_else(|| "en".into())
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let vi = lang(app) == "vi";
    let t = |v: &'static str, e: &'static str| if vi { v } else { e };
    let (locked, party) = app.state::<AppState>().store.read(|d| (d.setting_bool("locked", false), d.setting_bool("party", false)));
    let add_box = MenuItem::with_id(app, "add-box", t("Thêm Box", "Add box"), true, None::<&str>)?;
    let add_widget = MenuItem::with_id(app, "add-widget", t("Thêm Widget…", "Add widget…"), true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", t("Ẩn / hiện desktop", "Show / hide desktop"), true, None::<&str>)?;
    let lock = CheckMenuItem::with_id(app, "lock", t("Khoá bố cục", "Lock layout"), true, locked, None::<&str>)?;
    let party = CheckMenuItem::with_id(app, "party", t("Party mode (LED RGB)", "Party mode (RGB LEDs)"), true, party, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", t("Cài đặt", "Settings"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", t("Thoát PieDesk", "Quit PieDesk"), true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&add_box, &add_widget, &sep, &toggle, &lock, &party, &sep2, &settings, &quit])?;
    if let Some(version) = app.state::<AppState>().update.lock().unwrap().clone() {
        let label = if vi { format!("⬆ Cập nhật lên v{version}…") } else { format!("⬆ Update to v{version}…") };
        menu.insert(&MenuItem::with_id(app, "update", label, true, None::<&str>)?, 0)?;
        menu.insert(&PredefinedMenuItem::separator(app)?, 1)?;
    }
    Ok(menu)
}

/// Rebuilds the tray menu after the language or a checked setting changed.
fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Flips a boolean setting from the tray and broadcasts it like any other store change.
fn toggle_setting(app: &AppHandle, key: &str) {
    let state = app.state::<AppState>();
    let on = state.store.read(|d| d.setting_bool(key, false));
    let ops = vec![Op::Settings { value: serde_json::json!({ key: !on }) }];
    let rev = state.store.apply(&ops);
    let _ = app.emit("store://ops", OpsEvent { origin: "tray", rev, ops: &ops });
    refresh_tray(app);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip("PieDesk")
        .menu(&tray_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "add-box" => {
                let _ = app.emit("cmd://add-box", ());
            }
            "add-widget" => show_manager(app, Some("widgets")),
            "toggle" => toggle_visibility(app),
            "lock" => toggle_setting(app, "locked"),
            "party" => toggle_setting(app, "party"),
            "settings" => show_manager(app, None),
            "update" => show_manager(app, Some("settings")),
            "quit" => {
                app.state::<AppState>().store.flush();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_manager(tray.app_handle(), None);
            }
        })
        .build(app)?;
    Ok(())
}

/// Windows toast for agent sessions that just finished (setting `agentNotify`, on by default).
pub fn notify_finished(app: &AppHandle, sessions: &[agents::Session], finished: &[String]) {
    if finished.is_empty() || !app.state::<AppState>().store.read(|d| d.setting_bool("agentNotify", true)) {
        return;
    }
    let vi = lang(app) == "vi";
    for s in sessions.iter().filter(|s| finished.contains(&s.id)) {
        let who = if s.source == "claude" { "Claude Code" } else { "Antigravity" };
        let title = if vi { format!("✓ {who} đã xong") } else { format!("✓ {who} finished") };
        let body = if s.project.is_empty() { s.title.clone() } else { format!("{} · {}", s.title, s.project) };
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

/// "Start with Windows" is on by default: the first release run turns it on once and remembers
/// that it did, so switching it off in Settings sticks. Installs that already start from the
/// `Run` key (0.1.3) move to the faster logon task once.
fn enable_autostart_once(app: &AppHandle) {
    let state = app.state::<AppState>();
    if cfg!(debug_assertions) || state.store.read(|d| d.setting_bool("autostartTask", false)) {
        return;
    }
    let first_run = !state.store.read(|d| d.setting_bool("autostartInit", false));
    if (first_run || startup::is_enabled(app)) && !startup::set(app, true) {
        return;
    }
    state.store.apply(&[Op::Settings { value: serde_json::json!({ "autostartInit": true, "autostartTask": true }) }]);
}

/// Release builds look for a new version 30 s after start, then every 12 h (setting `autoUpdate`,
/// on by default). A find adds a tray item and one toast; installing happens in Settings, so an
/// update never restarts PieDesk under the user.
fn start_update_checks(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let _ = std::thread::Builder::new().name("updates".into()).spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        loop {
            let state = app.state::<AppState>();
            if state.store.read(|d| d.setting_bool("autoUpdate", true)) {
                let found = app.updater().ok().and_then(|u| tauri::async_runtime::block_on(u.check()).ok().flatten());
                if let Some(update) = found {
                    let is_new = state.update.lock().unwrap().replace(update.version.clone()).as_deref() != Some(&update.version);
                    if is_new {
                        refresh_tray(&app);
                        let vi = lang(&app) == "vi";
                        let (title, body) = if vi {
                            (format!("PieDesk v{} đã có", update.version), "Mở Cài đặt → Cập nhật để cài.".to_owned())
                        } else {
                            (format!("PieDesk v{} is available", update.version), "Open Settings → Updates to install it.".to_owned())
                        };
                        let _ = app.notification().builder().title(title).body(body).show();
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(12 * 3600));
        }
    });
}

fn register_hotkey(app: &AppHandle) {
    let state = app.state::<AppState>();
    let wanted = state.store.read(|d| d.setting_str("hotkey")).unwrap_or_else(|| DEFAULT_HOTKEY.into());
    let mut current = state.hotkey.lock().unwrap();
    if current.as_deref() == Some(wanted.as_str()) {
        return;
    }
    let gs = app.global_shortcut();
    if let Some(old) = current.take() {
        let _ = gs.unregister(old.as_str());
    }
    if !wanted.is_empty() && gs.register(wanted.as_str()).is_ok() {
        *current = Some(wanted);
    }
}

// ---------------------------------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_manager(app, None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_visibility(app);
                    }
                })
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol("icon", |ctx, request, responder| {
            match ctx.app_handle().try_state::<AppState>() {
                Some(state) => state.icons.handle(request, responder),
                None => responder.respond(tauri::http::Response::builder().status(503).body(Vec::new()).unwrap()),
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let config = app.path().app_config_dir()?;
            let cache = app.path().app_cache_dir()?;
            let log = app.path().app_log_dir().ok().map(|d| d.join("piedesk.log"));
            let state = AppState {
                store: Store::open(config.join("state.json"), log),
                hit: HitTest::default(),
                hub: Hub::default(),
                icons: IconService::new(cache.join("icons")),
                watches: Watches::default(),
                user_hidden: AtomicBool::new(false),
                surfaces: Mutex::new(HashMap::new()),
                hotkey: Mutex::new(None),
                update: Mutex::new(None),
                items_dir: app.path().app_data_dir()?.join("shortcuts"),
            };
            app.manage(state);

            surfaces::sync(&handle)?;
            surfaces::start_watch(handle.clone());
            catalog::watch(&handle);
            {
                let state = handle.state::<AppState>();
                state.hit.start(handle.clone());
                state.hub.start(handle.clone());
            }
            guard::start(handle.clone());
            build_tray(&handle)?;
            register_hotkey(&handle);
            enable_autostart_once(&handle);
            start_update_checks(handle.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            surface_info,
            store_get,
            store_apply,
            store_flush,
            hit_rects,
            hit_capture,
            open_path,
            import_item,
            remove_item,
            claim_item,
            gather_apps,
            app_catalog,
            take_app,
            autostart_get,
            autostart_set,
            is_owned_item,
            reveal_path,
            list_folder,
            watch_folder,
            unwatch_folder,
            hub_subscribe,
            hub_unsubscribe,
            open_manager,
            toggle_surfaces,
            surfaces::drag_over,
            surfaces::drag_end,
            surfaces::list_displays,
            guard::power_on_battery,
            media::media_art,
            media::media_control,
        ])
        .build(tauri::generate_context!())
        .expect("error while building PieDesk")
        .run(|app, event| match event {
            // Closing the manager must not quit: the surfaces and tray keep running.
            RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
            RunEvent::Exit => app.state::<AppState>().store.flush(),
            _ => {}
        });
}
