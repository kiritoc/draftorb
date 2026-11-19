#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings_file;

use std::sync::OnceLock;
use tauri::Manager;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();

/// Milliseconds since `main()` started, as seen by the Rust process.
/// The frontend calls this right after first render to report a cold-start
/// figure that includes shell + WebView2 bootstrap, not just JS time.
#[tauri::command]
fn process_uptime_ms() -> f64 {
    START
        .get()
        .map(|s| s.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(-1.0)
}

/// Settings JSON from the app config dir; `""` when missing or unreadable.
#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> String {
    app.path()
        .app_config_dir()
        .map(|dir| settings_file::load_from(&dir))
        .unwrap_or_default()
}

/// Atomically replaces the settings file in the app config dir.
#[tauri::command]
fn save_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    settings_file::save_to(&dir, &json)
}

/// Receives the frontend metrics JSON and writes it to a temp file so an
/// external benchmark script can measure wall-clock cold start and read the
/// engine latency numbers without any IPC back-channel.
#[tauri::command]
fn report_metrics(payload: String) {
    let path = std::env::temp_dir().join("draftorb-spike-metrics.json");
    let _ = std::fs::write(path, payload);
}

fn main() {
    START.set(Instant::now()).ok();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            process_uptime_ms,
            report_metrics,
            load_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running DraftOrb");
}
