#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_files;
mod data_cache;
mod profile_file;
mod repo_pool;

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

/// Allowlisted file from the app config dir; `""` when missing or unreadable.
#[tauri::command]
fn load_app_file(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    app_files::load_from(&dir, &name)
}

/// Atomically replaces an allowlisted file in the app config dir.
#[tauri::command]
fn save_app_file(app: tauri::AppHandle, name: String, json: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    app_files::save_to(&dir, &name, &json)
}

/// `<config>/data-cache/<name>` content, or `None` when missing.
#[tauri::command]
fn data_cache_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("data-cache");
    data_cache::read(&dir, &name)
}

/// Atomically writes `<config>/data-cache/<name>`.
#[tauri::command]
fn data_cache_write(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("data-cache");
    data_cache::write(&dir, &name, &content)
}

/// Removes every cached aggregate file.
#[tauri::command]
fn data_cache_clear(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("data-cache");
    data_cache::clear(&dir)
}

/// `<repo_folder>/data/public/profiles/<file_name>`, or `None` when missing.
#[tauri::command]
fn read_profile_file(repo_folder: String, file_name: String) -> Result<Option<String>, String> {
    profile_file::read(&repo_folder, &file_name)
}

/// Ok when `<repo_folder>/data` is a directory.
#[tauri::command]
fn check_repo_folder(repo_folder: String) -> Result<(), String> {
    repo_pool::check(&repo_folder)
}

/// `<repo_folder>/data/pool.config.json`, or `None` when it does not exist.
#[tauri::command]
fn read_repo_pool(repo_folder: String) -> Result<Option<String>, String> {
    repo_pool::read(&repo_folder)
}

/// Atomically writes `<repo_folder>/data/pool.config.json` (the folder must exist).
#[tauri::command]
fn write_repo_pool(repo_folder: String, json: String) -> Result<(), String> {
    repo_pool::write(&repo_folder, &json)
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
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            process_uptime_ms,
            report_metrics,
            load_app_file,
            save_app_file,
            check_repo_folder,
            read_profile_file,
            read_repo_pool,
            write_repo_pool,
            data_cache_read,
            data_cache_write,
            data_cache_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running DraftOrb");
}
