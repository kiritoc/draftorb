//! Program-stored settings file (D-101): `settings.json` in the app config dir.

use std::fs;
use std::path::Path;

const FILE_NAME: &str = "settings.json";
const TMP_NAME: &str = "settings.json.tmp";

/// Returns the file content, or `""` when it is missing or unreadable.
pub fn load_from(dir: &Path) -> String {
    fs::read_to_string(dir.join(FILE_NAME)).unwrap_or_default()
}

/// Writes `settings.json.tmp` then renames it over `settings.json`.
pub fn save_to(dir: &Path, json: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(TMP_NAME);
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(FILE_NAME)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("draftorb-settings-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn load_returns_empty_for_a_missing_file() {
        assert_eq!(load_from(&temp_dir("missing")), "");
    }

    #[test]
    fn save_creates_the_dir_and_round_trips_atomically() {
        let dir = temp_dir("roundtrip").join("nested");
        save_to(&dir, "{\"version\":1}").unwrap();
        assert_eq!(load_from(&dir), "{\"version\":1}");
        assert!(!dir.join(TMP_NAME).exists());
        save_to(&dir, "{\"version\":2}").unwrap();
        assert_eq!(load_from(&dir), "{\"version\":2}");
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn load_returns_empty_when_the_path_is_not_a_file() {
        let dir = temp_dir("unreadable");
        fs::create_dir_all(dir.join(FILE_NAME)).unwrap();
        assert_eq!(load_from(&dir), "");
        let _ = fs::remove_dir_all(&dir);
    }
}
