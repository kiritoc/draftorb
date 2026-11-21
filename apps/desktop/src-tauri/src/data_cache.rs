//! Downloaded aggregate cache under `<config>/data-cache/` (BL-010b, D-111).
//! Names are relative posix paths (`latest.json`, `16.22/champions.json`);
//! `..`, absolute paths and backslashes are rejected so the frontend can
//! never escape the cache dir.

use std::fs;
use std::path::Path;

fn resolve(dir: &Path, name: &str) -> Result<std::path::PathBuf, String> {
    if name.is_empty()
        || name.starts_with('/')
        || name.contains('\\')
        || name.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..")
    {
        return Err(format!("invalid cache name: {name}"));
    }
    let path = dir.join(name);
    if !path.starts_with(dir) {
        return Err(format!("cache name escapes dir: {name}"));
    }
    Ok(path)
}

/// File content as UTF-8, or `None` when missing/not a file/not UTF-8.
pub fn read(dir: &Path, name: &str) -> Result<Option<String>, String> {
    let path = resolve(dir, name)?;
    match fs::read(&path) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| format!("cache file is not UTF-8: {name}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic write (`<name>.tmp` then rename), creating parent dirs.
pub fn write(dir: &Path, name: &str, content: &str) -> Result<(), String> {
    let path = resolve(dir, name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Removes the whole cache dir contents (keeps the dir).
pub fn clear(dir: &Path) -> Result<(), String> {
    if dir.exists() {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.is_dir() {
                fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("draftorb-cache-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn round_trip_nested_name() {
        let dir = temp_dir("roundtrip");
        write(&dir, "16.22/champions.json", "{}").unwrap();
        assert_eq!(read(&dir, "16.22/champions.json").unwrap().as_deref(), Some("{}"));
        assert_eq!(read(&dir, "latest.json").unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_traversal_and_bad_names() {
        let dir = temp_dir("reject");
        for name in ["", "../x", "a/../b", "/abs", "a\\b", "a//b", "./x"] {
            assert!(write(&dir, name, "x").is_err(), "{name}");
            assert!(read(&dir, name).is_err(), "{name}");
        }
        assert!(!dir.exists());
    }

    #[test]
    fn clear_empties_the_dir() {
        let dir = temp_dir("clear");
        write(&dir, "latest.json", "{}").unwrap();
        write(&dir, "16.22/x.json", "{}").unwrap();
        clear(&dir).unwrap();
        assert_eq!(read(&dir, "latest.json").unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
