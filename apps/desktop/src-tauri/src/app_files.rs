//! Program-stored files in the app config dir (D-101): an allowlist of names, so
//! the frontend can never read or write anywhere else (no path traversal).

use std::fs;
use std::path::Path;

const ALLOWED: [&str; 2] = ["settings.json", "pool.json"];

fn check_name(name: &str) -> Result<(), String> {
    if ALLOWED.contains(&name) {
        Ok(())
    } else {
        Err(format!("file not allowed: {name}"))
    }
}

/// Returns the file content, or `""` when it is missing or unreadable.
pub fn load_from(dir: &Path, name: &str) -> Result<String, String> {
    check_name(name)?;
    Ok(fs::read_to_string(dir.join(name)).unwrap_or_default())
}

/// Writes `<name>.tmp` then renames it over `<name>`, creating `dir` if needed.
pub fn save_to(dir: &Path, name: &str, json: &str) -> Result<(), String> {
    check_name(name)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    write_atomic(dir, name, json)
}

/// Temp-file write plus rename inside an existing directory.
pub fn write_atomic(dir: &Path, name: &str, content: &str) -> Result<(), String> {
    let tmp = dir.join(format!("{name}.tmp"));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("draftorb-appfiles-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn load_returns_empty_for_a_missing_file() {
        assert_eq!(load_from(&temp_dir("missing"), "settings.json").unwrap(), "");
    }

    #[test]
    fn save_creates_the_dir_and_round_trips_atomically() {
        let dir = temp_dir("roundtrip").join("nested");
        save_to(&dir, "pool.json", "{\"a\":1}").unwrap();
        assert_eq!(load_from(&dir, "pool.json").unwrap(), "{\"a\":1}");
        assert!(!dir.join("pool.json.tmp").exists());
        save_to(&dir, "pool.json", "{\"a\":2}").unwrap();
        assert_eq!(load_from(&dir, "pool.json").unwrap(), "{\"a\":2}");
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn load_returns_empty_when_the_path_is_not_a_file() {
        let dir = temp_dir("unreadable");
        fs::create_dir_all(dir.join("settings.json")).unwrap();
        assert_eq!(load_from(&dir, "settings.json").unwrap(), "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_allowlist_rejects_traversal_and_other_names() {
        let dir = temp_dir("allowlist");
        for name in ["../x.json", "other.json", "settings.json/../pool.json", ""] {
            assert!(load_from(&dir, name).is_err(), "{name}");
            assert!(save_to(&dir, name, "x").is_err(), "{name}");
        }
        assert!(!dir.exists());
    }
}
