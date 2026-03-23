use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri should live under the repository root")
        .to_path_buf()
}

fn tauri_config() -> Value {
    let config_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = fs::read_to_string(&config_path).expect("failed to read tauri.conf.json");

    serde_json::from_str(&raw).expect("tauri.conf.json should contain valid JSON")
}

fn package_json() -> Value {
    let package_path = repo_root().join("package.json");
    let raw = fs::read_to_string(&package_path).expect("failed to read package.json");

    serde_json::from_str(&raw).expect("package.json should contain valid JSON")
}

fn collect_artifacts(root: &Path, extension: &str, output: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            collect_artifacts(&path, extension, output);
            continue;
        }

        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(extension))
        {
            output.push(path);
        }
    }
}

#[test]
fn release_configuration_enables_linux_appimage_and_deb_bundles() {
    let tauri_config = tauri_config();
    let package_json = package_json();

    assert_eq!(tauri_config["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(package_json["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(tauri_config["bundle"]["active"], true);

    let targets = tauri_config["bundle"]["targets"]
        .as_array()
        .expect("bundle.targets should be an array");
    let targets = targets
        .iter()
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>();

    assert_eq!(targets, vec!["appimage", "deb"]);

    let icons = tauri_config["bundle"]["icon"]
        .as_array()
        .expect("bundle.icon should be an array");
    assert!(
        icons.iter()
            .any(|value| value.as_str() == Some("icons/icon.png")),
        "bundle.icon should include the shipping Linux icon"
    );
}

#[test]
fn release_artifacts_match_expected_linux_bundle_shape_when_present() {
    let bundle_dir = env::var_os("DISPATCH_RELEASE_BUNDLE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root().join("target/release/bundle"));
    let require_artifacts = env::var("DISPATCH_REQUIRE_RELEASE_ARTIFACTS").ok().as_deref() == Some("1");

    if !bundle_dir.exists() {
        assert!(
            !require_artifacts,
            "expected bundled release artifacts under {}",
            bundle_dir.display()
        );
        return;
    }

    let mut appimages = Vec::new();
    let mut debs = Vec::new();

    collect_artifacts(&bundle_dir, ".AppImage", &mut appimages);
    collect_artifacts(&bundle_dir, ".deb", &mut debs);

    assert!(
        !appimages.is_empty(),
        "expected at least one AppImage artifact under {}",
        bundle_dir.display()
    );
    assert!(
        !debs.is_empty(),
        "expected at least one deb artifact under {}",
        bundle_dir.display()
    );

    for artifact in appimages.iter().chain(debs.iter()) {
        let file_name = artifact
            .file_name()
            .and_then(|name| name.to_str())
            .expect("artifact path should contain a file name");

        assert!(
            file_name.contains(env!("CARGO_PKG_VERSION")),
            "artifact {} should include the release version {}",
            artifact.display(),
            env!("CARGO_PKG_VERSION")
        );
    }
}
