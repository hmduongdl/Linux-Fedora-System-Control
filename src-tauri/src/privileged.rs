use serde::Serialize;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct HelperStatus {
    pub helper_exists: bool,
    pub policy_exists: bool,
    pub rules_exists: bool,
    pub is_correct: bool,
}

#[tauri::command]
pub fn check_helper_installation() -> HelperStatus {
    let helper = Path::new("/usr/libexec/purrdora-helper");
    let policy = Path::new("/usr/share/polkit-1/actions/com.purrdora.pkexec.policy");
    let rules = Path::new("/etc/polkit-1/rules.d/99-purrdora.rules");
    let helper_exists = helper.is_file();
    let policy_exists = policy.is_file();
    let rules_exists = rules.is_file();
    let helper_secure = helper_exists
        && helper
            .metadata()
            .map(|m| {
                #[cfg(unix)]
                {
                    m.uid() == 0 && m.gid() == 0 && m.mode() & 0o022 == 0 && m.mode() & 0o111 != 0
                }
                #[cfg(not(unix))]
                {
                    true
                }
            })
            .unwrap_or(false);
    let config_secure = |p: &Path| {
        p.metadata()
            .map(|m| {
                #[cfg(unix)]
                {
                    m.uid() == 0 && m.gid() == 0 && m.mode() & 0o022 == 0
                }
                #[cfg(not(unix))]
                {
                    true
                }
            })
            .unwrap_or(false)
    };

    // Check if everything is correctly installed
    let is_correct = helper_secure
        && policy_exists
        && rules_exists
        && config_secure(policy)
        && config_secure(rules);

    HelperStatus {
        helper_exists,
        policy_exists,
        rules_exists,
        is_correct,
    }
}

pub fn run_privileged_action(action: &str, value: &str) -> Result<(), String> {
    let installed = Path::new("/usr/libexec/purrdora-helper");
    let dev = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("purrdora-helper")));
    let helper_path: PathBuf = if installed.is_file() {
        installed.to_path_buf()
    } else if let Some(path) = dev.filter(|path| path.is_file()) {
        path
    } else {
        return Err("purrdora-helper not found. Install the packaged helper or build it with `cargo build --bin purrdora-helper`.".to_owned());
    };
    {
        let output = Command::new("pkexec")
            .args([helper_path.to_string_lossy().as_ref(), action, value])
            .output()
            .map_err(|e| format!("Failed to run pkexec: {}", e))?;
        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(format!("Helper error: {}", stderr))
        }
    }
}
