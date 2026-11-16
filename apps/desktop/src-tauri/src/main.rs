#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::OnceLock;
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
        .invoke_handler(tauri::generate_handler![process_uptime_ms, report_metrics])
        .run(tauri::generate_context!())
        .expect("error while running DraftOrb spike");
}
