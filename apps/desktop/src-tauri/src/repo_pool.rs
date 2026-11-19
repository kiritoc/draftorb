//! Repo pool file `<repo>/data/pool.config.json` (D-114, D-118, SPECS §19.3).

use crate::app_files::write_atomic;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

const FILE_NAME: &str = "pool.config.json";
const NOT_A_REPO: &str = "not a DraftOrb repo folder: data/ missing";

pub(crate) fn data_dir(repo_folder: &str) -> Result<PathBuf, String> {
    let dir = Path::new(repo_folder).join("data");
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(NOT_A_REPO.to_string())
    }
}

/// Ok when `<repo>/data` is a directory (the repo folder setting check).
pub fn check(repo_folder: &str) -> Result<(), String> {
    data_dir(repo_folder).map(|_| ())
}

/// `Ok(None)` when the file does not exist.
pub fn read(repo_folder: &str) -> Result<Option<String>, String> {
    let dir = data_dir(repo_folder)?;
    match fs::read_to_string(dir.join(FILE_NAME)) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {FILE_NAME}: {e}")),
    }
}

/// Never creates folders: `<repo>/data` must already exist.
pub fn write(repo_folder: &str, json: &str) -> Result<(), String> {
    let dir = data_dir(repo_folder)?;
    write_atomic(&dir, FILE_NAME, json)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str, with_data: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("draftorb-repopool-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(if with_data { dir.join("data") } else { dir.clone() }).unwrap();
        dir
    }

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    #[test]
    fn check_accepts_a_folder_with_data_and_rejects_one_without() {
        assert!(check(s(&repo("check-ok", true))).is_ok());
        assert_eq!(check(s(&repo("check-no", false))).unwrap_err(), NOT_A_REPO);
    }

    #[test]
    fn read_returns_none_when_the_file_is_missing() {
        let dir = repo("none", true);
        assert_eq!(read(s(&dir)).unwrap(), None);
    }

    #[test]
    fn read_fails_without_a_data_dir() {
        let dir = repo("nodata", false);
        assert_eq!(read(s(&dir)).unwrap_err(), NOT_A_REPO);
    }

    #[test]
    fn read_returns_the_existing_file() {
        let dir = repo("some", true);
        fs::write(dir.join("data").join(FILE_NAME), "{}").unwrap();
        assert_eq!(read(s(&dir)).unwrap(), Some("{}".to_string()));
    }

    #[test]
    fn write_refuses_without_a_data_dir_and_creates_nothing() {
        let dir = repo("refuse", false);
        assert!(write(s(&dir), "{}").is_err());
        assert!(!dir.join("data").exists());
    }

    #[test]
    fn write_round_trips_and_leaves_no_tmp_file() {
        let dir = repo("write", true);
        write(s(&dir), "{\"a\":1}\n").unwrap();
        assert_eq!(read(s(&dir)).unwrap(), Some("{\"a\":1}\n".to_string()));
        assert!(!dir.join("data").join("pool.config.json.tmp").exists());
    }
}
