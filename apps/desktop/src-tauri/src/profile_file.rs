//! Read-only access to the local profile export (SPECS §19.2, D-118):
//! `<repo>/data/public/profiles/<file_name>`.

use crate::repo_pool::data_dir;
use std::fs;
use std::io::ErrorKind;

/// `^[a-z0-9][a-z0-9-]*\.json$`: a plain file name, never a path.
fn valid_file_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".json") else {
        return false;
    };
    let mut chars = stem.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `Ok(None)` when the file or the `profiles` folder does not exist.
pub fn read(repo_folder: &str, file_name: &str) -> Result<Option<String>, String> {
    if !valid_file_name(file_name) {
        return Err(format!("invalid profile file name: {file_name}"));
    }
    let path = data_dir(repo_folder)?
        .join("public")
        .join("profiles")
        .join(file_name);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {file_name}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("draftorb-profile-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("data")).unwrap();
        dir
    }

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    #[test]
    fn accepts_plain_json_names() {
        for name in ["index.json", "kiritoctoc-euw1.json", "1a.json"] {
            assert!(valid_file_name(name), "{name}");
        }
    }

    #[test]
    fn rejects_paths_and_other_names() {
        for name in ["../x.json", "a/b.json", "A.json", "x.txt", ".json", "a.b.json", "-a.json", ""] {
            assert!(!valid_file_name(name), "{name}");
        }
    }

    #[test]
    fn read_rejects_an_invalid_name_before_touching_the_disk() {
        assert!(read(s(&repo("badname")), "../x.json").is_err());
    }

    #[test]
    fn missing_profiles_dir_or_file_is_none() {
        let dir = repo("none");
        assert_eq!(read(s(&dir), "index.json").unwrap(), None);
        fs::create_dir_all(dir.join("data").join("public").join("profiles")).unwrap();
        assert_eq!(read(s(&dir), "index.json").unwrap(), None);
    }

    #[test]
    fn missing_data_dir_is_an_error() {
        let dir = std::env::temp_dir().join(format!("draftorb-profile-nodata-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(read(s(&dir), "index.json").is_err());
    }

    #[test]
    fn reads_an_existing_file() {
        let dir = repo("some");
        let profiles = dir.join("data").join("public").join("profiles");
        fs::create_dir_all(&profiles).unwrap();
        fs::write(profiles.join("index.json"), "{}").unwrap();
        assert_eq!(read(s(&dir), "index.json").unwrap(), Some("{}".to_string()));
    }
}
