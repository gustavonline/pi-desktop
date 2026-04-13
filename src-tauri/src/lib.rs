use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
struct RpcProcessHandle {
    generation: u64,
    process: Option<Child>,
    stdin_writer: Option<std::process::ChildStdin>,
}

/// State for managing multiple RPC child processes (one per instance)
pub struct RpcState {
    instances: Arc<Mutex<HashMap<String, RpcProcessHandle>>>,
}

impl Default for RpcState {
    fn default() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct RpcLineEventPayload {
    instance_id: String,
    generation: u64,
    line: String,
}

#[derive(Debug, Serialize, Clone)]
struct RpcClosedEventPayload {
    instance_id: String,
    generation: u64,
    reason: String,
}

#[derive(Debug, Serialize)]
struct RpcStartResult {
    discovery: String,
    generation: u64,
}

fn normalize_instance_id(instance_id: Option<String>) -> String {
    let raw = instance_id.unwrap_or_else(|| "default".to_string());
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.to_string()
    }
}

fn stop_rpc_instance(handle: &mut RpcProcessHandle) {
    handle.stdin_writer = None;
    if let Some(mut child) = handle.process.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct RpcStartOptions {
    /// Dev-mode only: path to the CLI JS file (e.g. "../coding-agent/dist/cli.js").
    /// When null/empty, the backend discovers the pi binary automatically.
    cli_path: Option<String>,
    /// Optional explicit pi binary path override from Desktop settings.
    /// When set, this takes precedence over sidecar/PATH/common-location discovery.
    pi_path: Option<String>,
    cwd: String,
    provider: Option<String>,
    model: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
}

/// How the pi process was resolved
#[derive(Debug, Clone)]
enum PiProcess {
    /// Dev mode: node <script> --mode rpc
    DevNode { script: String },
    /// Packaged sidecar binary bundled with the desktop app
    SidecarBinary { path: std::path::PathBuf },
    /// Production/dev fallback: standalone pi binary found on PATH
    PathBinary { path: std::path::PathBuf },
}

fn find_sidecar_in_dir(dir: &Path, expected_name: &str) -> Option<PathBuf> {
    let exact = dir.join(expected_name);
    if exact.is_file() {
        return Some(exact);
    }

    None
}

fn discover_sidecar(app: &AppHandle) -> Option<PathBuf> {
    let default_target = if cfg!(target_os = "windows") {
        format!("{}-pc-windows-msvc", std::env::consts::ARCH)
    } else if cfg!(target_os = "macos") {
        format!("{}-apple-darwin", std::env::consts::ARCH)
    } else if cfg!(target_os = "linux") {
        format!("{}-unknown-linux-gnu", std::env::consts::ARCH)
    } else {
        format!(
            "{}-unknown-{}",
            std::env::consts::ARCH,
            std::env::consts::OS
        )
    };

    let target = std::env::var("TARGET").unwrap_or(default_target);

    let extension = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let expected_name = format!("pi-{}{}", target, extension);

    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidate_dirs.push(resource_dir.clone());
        candidate_dirs.push(resource_dir.join("binaries"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidate_dirs.push(parent.to_path_buf());
            candidate_dirs.push(parent.join("binaries"));
            candidate_dirs.push(parent.join(".."));
            candidate_dirs.push(parent.join("..").join("Resources"));
            candidate_dirs.push(parent.join("..").join("Resources").join("binaries"));
        }
    }

    for dir in candidate_dirs {
        if !dir.exists() || !dir.is_dir() {
            continue;
        }
        if let Some(found) = find_sidecar_in_dir(&dir, &expected_name) {
            return Some(found);
        }
    }

    None
}

fn resolve_home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        if !user_profile.trim().is_empty() {
            return Some(PathBuf::from(user_profile));
        }
    }
    None
}

fn expand_tilde_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        if let Some(home) = resolve_home_dir() {
            return home;
        }
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = resolve_home_dir() {
            return home.join(rest);
        }
    }
    if let Some(rest) = trimmed.strip_prefix("~\\") {
        if let Some(home) = resolve_home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn resolve_explicit_pi_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let expanded = expand_tilde_path(trimmed);
    if expanded.is_file() {
        return Some(expanded);
    }

    if let Ok(which_path) = which::which(trimmed) {
        return Some(which_path);
    }

    None
}

fn discover_pi_from_common_locations() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if cfg!(target_os = "windows") {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let app_data_dir = PathBuf::from(app_data);
            candidates.push(app_data_dir.join("npm").join("pi.cmd"));
            candidates.push(app_data_dir.join("npm").join("pi.exe"));
            candidates.push(app_data_dir.join("npm").join("pi.bat"));
            candidates.push(app_data_dir.join("npm").join("pi"));
        }

        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let local_app_data_dir = PathBuf::from(local_app_data);
            candidates.push(local_app_data_dir.join("npm").join("pi.cmd"));
            candidates.push(local_app_data_dir.join("npm").join("pi.exe"));
        }

        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let user_dir = PathBuf::from(user_profile);
            candidates.push(
                user_dir
                    .join("AppData")
                    .join("Roaming")
                    .join("npm")
                    .join("pi.cmd"),
            );
            candidates.push(
                user_dir
                    .join("AppData")
                    .join("Roaming")
                    .join("npm")
                    .join("pi.exe"),
            );
            candidates.push(user_dir.join("scoop").join("shims").join("pi.cmd"));
        }

        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("nodejs").join("pi.cmd"));
        }

        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(program_files_x86).join("nodejs").join("pi.cmd"));
        }

        if let Ok(program_data) = std::env::var("ProgramData") {
            let program_data_dir = PathBuf::from(program_data);
            candidates.push(program_data_dir.join("npm").join("pi.cmd"));
            candidates.push(program_data_dir.join("npm").join("pi.exe"));
        }

        if let Ok(nvm_home) = std::env::var("NVM_HOME") {
            candidates.push(PathBuf::from(nvm_home).join("pi.cmd"));
        }

        if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
            candidates.push(PathBuf::from(nvm_symlink).join("pi.cmd"));
        }

        return candidates.into_iter().find(|candidate| candidate.is_file());
    }

    if let Some(home_dir) = resolve_home_dir() {
        // nvm installations (common for npm global installs)
        candidates.push(home_dir.join(".nvm/versions/node/current/bin/pi"));
        let nvm_versions_dir = home_dir.join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(nvm_versions_dir) {
            let mut version_dirs: Vec<PathBuf> = entries
                .filter_map(|entry| {
                    let path = entry.ok()?.path();
                    if path.is_dir() {
                        Some(path)
                    } else {
                        None
                    }
                })
                .collect();
            version_dirs.sort_by(|a, b| b.cmp(a));
            for version_dir in version_dirs {
                candidates.push(version_dir.join("bin/pi"));
            }
        }

        // Other common per-user install locations
        candidates.push(home_dir.join(".pi/agent/bin/pi"));
        candidates.push(home_dir.join(".volta/bin/pi"));
        candidates.push(home_dir.join(".local/bin/pi"));
        candidates.push(home_dir.join(".npm-global/bin/pi"));
        candidates.push(home_dir.join(".npm/bin/pi"));
    }

    // npm custom prefix installs (common on Linux/macOS desktop launches)
    for key in ["NPM_CONFIG_PREFIX", "PREFIX"] {
        if let Ok(prefix) = std::env::var(key) {
            let trimmed = prefix.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed).join("bin/pi"));
                candidates.push(PathBuf::from(trimmed).join("pi"));
            }
        }
    }

    // Common system install locations
    candidates.push(PathBuf::from("/opt/homebrew/bin/pi"));
    candidates.push(PathBuf::from("/usr/local/bin/pi"));
    candidates.push(PathBuf::from("/usr/bin/pi"));

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn prepend_bin_dir_to_path(cmd: &mut Command, bin_dir: &Path) {
    let mut path_entries = vec![bin_dir.to_path_buf()];
    if let Some(existing) = std::env::var_os("PATH") {
        path_entries.extend(std::env::split_paths(&existing));
    }

    if let Ok(joined) = std::env::join_paths(path_entries) {
        cmd.env("PATH", joined);
    }
}

fn discover_npm_path(pi: Option<&PiProcess>) -> Option<PathBuf> {
    let npm = npm_executable();

    if let Ok(path) = which::which(npm) {
        return Some(path);
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(PiProcess::PathBinary { path }) = pi {
        if let Some(parent) = path.parent() {
            candidates.push(parent.join(npm));
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let home_dir = PathBuf::from(home);
        candidates.push(home_dir.join(".nvm/versions/node/current/bin").join(npm));

        let nvm_versions_dir = home_dir.join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(nvm_versions_dir) {
            let mut version_dirs: Vec<PathBuf> = entries
                .filter_map(|entry| {
                    let path = entry.ok()?.path();
                    if path.is_dir() {
                        Some(path)
                    } else {
                        None
                    }
                })
                .collect();
            version_dirs.sort_by(|a, b| b.cmp(a));
            for version_dir in version_dirs {
                candidates.push(version_dir.join("bin").join(npm));
            }
        }

        candidates.push(home_dir.join(".volta/bin").join(npm));
        candidates.push(home_dir.join(".local/bin").join(npm));
    }

    candidates.push(PathBuf::from("/opt/homebrew/bin").join(npm));
    candidates.push(PathBuf::from("/usr/local/bin").join(npm));
    candidates.push(PathBuf::from("/usr/bin").join(npm));

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn discover_npm_global_root(pi: Option<&PiProcess>) -> Option<PathBuf> {
    let npm_path = discover_npm_path(pi)?;

    let mut cmd = Command::new(&npm_path);
    cmd.arg("root")
        .arg("-g")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(parent) = npm_path.parent() {
        prepend_bin_dir_to_path(&mut cmd, parent);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let root = stdout
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())?;

    let path = PathBuf::from(root);
    if path.is_dir() {
        Some(path)
    } else {
        None
    }
}

fn resolve_pi_changelog_candidates(pi: &PiProcess) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(pkg_dir) = std::env::var("PI_PACKAGE_DIR") {
        let trimmed = pkg_dir.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join("CHANGELOG.md"));
        }
    }

    match pi {
        PiProcess::DevNode { script } => {
            let script_path = PathBuf::from(script);
            if let Some(dist_dir) = script_path.parent() {
                candidates.push(dist_dir.join("..").join("CHANGELOG.md"));
            }
        }
        PiProcess::PathBinary { path } | PiProcess::SidecarBinary { path } => {
            let mut binaries = vec![path.clone()];
            if let Ok(canonical) = fs::canonicalize(path) {
                binaries.push(canonical);
            }
            for binary in binaries {
                if let Some(parent) = binary.parent() {
                    candidates.push(
                        parent
                            .join("..")
                            .join("lib")
                            .join("node_modules")
                            .join("@mariozechner")
                            .join("pi-coding-agent")
                            .join("CHANGELOG.md"),
                    );
                    candidates.push(
                        parent
                            .join("..")
                            .join("node_modules")
                            .join("@mariozechner")
                            .join("pi-coding-agent")
                            .join("CHANGELOG.md"),
                    );
                    candidates.push(
                        parent
                            .join("..")
                            .join("..")
                            .join("lib")
                            .join("node_modules")
                            .join("@mariozechner")
                            .join("pi-coding-agent")
                            .join("CHANGELOG.md"),
                    );
                }
            }
        }
    }

    if let Some(global_root) = discover_npm_global_root(Some(pi)) {
        candidates.push(
            global_root
                .join("@mariozechner")
                .join("pi-coding-agent")
                .join("CHANGELOG.md"),
        );
    }

    candidates
}

fn discover_pi_from_env_override() -> Option<PathBuf> {
    for key in ["PI_DESKTOP_PI_PATH", "PI_CLI_PATH"] {
        if let Ok(raw) = std::env::var(key) {
            if let Some(path) = resolve_explicit_pi_path(&raw) {
                return Some(path);
            }
        }
    }
    None
}

fn missing_pi_cli_error(additional: Option<String>) -> String {
    let mut message = String::from(
        "Could not find the pi CLI.\n\nInstall it with:\n  npm install -g @mariozechner/pi-coding-agent\n\nThen restart the app.",
    );
    if let Some(extra) = additional {
        let trimmed = extra.trim();
        if !trimmed.is_empty() {
            message.push_str("\n\n");
            message.push_str(trimmed);
        }
    }
    message
}

/// Discover the pi binary. Strategy:
/// 1. If pi_path is provided (Desktop manual override), use it
/// 2. If cli_path is provided (dev mode), use node + script or explicit binary
/// 3. Try explicit env override (PI_DESKTOP_PI_PATH / PI_CLI_PATH)
/// 4. Try sidecar discovery (packaged app)
/// 5. Try finding `pi` on PATH (globally installed CLI or standalone binary)
/// 6. Try common install locations (for GUI app launches without shell PATH)
/// 7. Fail with actionable error
fn discover_pi(app: &AppHandle, options: &RpcStartOptions) -> Result<PiProcess, String> {
    // Desktop manual override from settings
    if let Some(ref pi_path) = options.pi_path {
        let trimmed = pi_path.trim();
        if !trimmed.is_empty() {
            if let Some(path) = resolve_explicit_pi_path(trimmed) {
                return Ok(PiProcess::PathBinary { path });
            }
            return Err(missing_pi_cli_error(Some(format!(
                "Configured pi binary path was not found: {}",
                trimmed
            ))));
        }
    }

    // Dev mode: cli_path explicitly provided
    if let Some(ref cli_path) = options.cli_path {
        let trimmed = cli_path.trim();
        if !trimmed.is_empty() {
            if trimmed.ends_with(".js") || trimmed.ends_with(".mjs") || trimmed.ends_with(".cjs") {
                return Ok(PiProcess::DevNode {
                    script: trimmed.to_string(),
                });
            }
            if let Some(path) = resolve_explicit_pi_path(trimmed) {
                return Ok(PiProcess::PathBinary { path });
            }
        }
    }

    // Explicit environment override
    if let Some(path) = discover_pi_from_env_override() {
        return Ok(PiProcess::PathBinary { path });
    }

    // Packaged app: bundled sidecar
    if let Some(path) = discover_sidecar(app) {
        return Ok(PiProcess::SidecarBinary { path });
    }

    // Fallback: pi on PATH
    if let Ok(path) = which::which("pi") {
        return Ok(PiProcess::PathBinary { path });
    }

    // GUI launches on macOS often don't inherit shell PATH (e.g. nvm-managed node/npm bins)
    if let Some(path) = discover_pi_from_common_locations() {
        return Ok(PiProcess::PathBinary { path });
    }

    Err(missing_pi_cli_error(None))
}

/// Build a Command for the discovered pi process
fn build_command(pi: &PiProcess, options: &RpcStartOptions) -> Command {
    let mut cmd = match pi {
        PiProcess::DevNode { script } => {
            let mut c = Command::new("node");
            c.arg(script);
            c
        }
        PiProcess::SidecarBinary { path } | PiProcess::PathBinary { path } => Command::new(path),
    };

    cmd.arg("--mode").arg("rpc");

    if let Some(ref provider) = options.provider {
        cmd.arg("--provider").arg(provider);
    }
    if let Some(ref model) = options.model {
        cmd.arg("--model").arg(model);
    }

    cmd.current_dir(&options.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Merge environment variables
    if let Some(ref env) = options.env {
        for (key, value) in env {
            cmd.env(key, value);
        }
    }

    // If using a script-based pi binary (e.g. npm global install), ensure its bin dir
    // is on PATH so shebangs like `#!/usr/bin/env node` can resolve node in GUI launches.
    if let PiProcess::PathBinary { path } = pi {
        if let Some(parent) = path.parent() {
            prepend_bin_dir_to_path(&mut cmd, parent);
        }
    }

    // On Windows, prevent console window from appearing
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd
}

fn write_rpc_line(stdin: &mut std::process::ChildStdin, line: &str) -> Result<(), String> {
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write to stdin: {}", e))?;
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("Failed to write newline: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("Failed to flush stdin: {}", e))?;
    Ok(())
}

/// Start the pi coding agent in RPC mode as a child process.
/// Discovery order: manual pi_path -> dev cli_path -> env override -> sidecar -> PATH/common locations -> error.
#[tauri::command]
async fn rpc_start(
    app: AppHandle,
    state: tauri::State<'_, RpcState>,
    options: RpcStartOptions,
    instance_id: Option<String>,
) -> Result<RpcStartResult, String> {
    let instance_id = normalize_instance_id(instance_id);

    let generation = if let Ok(mut instances) = state.instances.lock() {
        if let Some(handle) = instances.get_mut(&instance_id) {
            let next_generation = handle.generation.saturating_add(1).max(1);
            stop_rpc_instance(handle);
            next_generation
        } else {
            1
        }
    } else {
        return Err("Failed to acquire RPC instances lock".to_string());
    };

    let cwd_path = Path::new(&options.cwd);
    if !cwd_path.is_dir() {
        return Err(format!("Working directory does not exist: {}", options.cwd));
    }

    let pi = discover_pi(&app, &options)?;
    let discovery_label = format!("{:?}", pi);

    let mut cmd = build_command(&pi, &options);
    let mut child = cmd.spawn().map_err(|e| {
        let lower = e.to_string().to_lowercase();
        let missing_executable = matches!(e.raw_os_error(), Some(2) | Some(3))
            || e.kind() == std::io::ErrorKind::NotFound
            || (lower.contains("createprocess") && lower.contains("cannot find"));
        if missing_executable {
            return missing_pi_cli_error(Some(format!(
                "Discovery details: {:?}\nSpawn error: {}",
                pi, e
            )));
        }
        format!("Failed to spawn pi process ({:?}): {}", pi, e)
    })?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    // Store process + stdin handle for this instance
    if let Ok(mut instances) = state.instances.lock() {
        instances.insert(
            instance_id.clone(),
            RpcProcessHandle {
                generation,
                process: Some(child),
                stdin_writer: Some(stdin),
            },
        );
    } else {
        return Err("Failed to acquire RPC instances lock".to_string());
    }

    // Spawn thread to read stdout and emit events to frontend
    let app_handle = app.clone();
    let stdout_instance_id = instance_id.clone();
    let stdout_generation = generation;
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let payload = RpcLineEventPayload {
                        instance_id: stdout_instance_id.clone(),
                        generation: stdout_generation,
                        line,
                    };
                    let _ = app_handle.emit("rpc-event", payload);
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(
            "rpc-closed",
            RpcClosedEventPayload {
                instance_id: stdout_instance_id,
                generation: stdout_generation,
                reason: "process exited".to_string(),
            },
        );
    });

    // Spawn thread to read stderr
    let app_handle_err = app.clone();
    let stderr_instance_id = instance_id.clone();
    let stderr_generation = generation;
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let payload = RpcLineEventPayload {
                        instance_id: stderr_instance_id.clone(),
                        generation: stderr_generation,
                        line,
                    };
                    let _ = app_handle_err.emit("rpc-stderr", payload);
                }
                Err(_) => break,
            }
        }
    });

    Ok(RpcStartResult {
        discovery: format!("{} [instance:{}]", discovery_label, instance_id),
        generation,
    })
}

/// Send a JSON command to an RPC process stdin
#[tauri::command]
async fn rpc_send(
    state: tauri::State<'_, RpcState>,
    command: String,
    instance_id: Option<String>,
) -> Result<(), String> {
    let instance_id = normalize_instance_id(instance_id);
    if let Ok(mut instances) = state.instances.lock() {
        if let Some(handle) = instances.get_mut(&instance_id) {
            if let Some(ref mut stdin) = handle.stdin_writer {
                write_rpc_line(stdin, &command)
            } else {
                Err(format!("RPC process not started for instance '{}'", instance_id))
            }
        } else {
            Err(format!("RPC process not started for instance '{}'", instance_id))
        }
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Stop an RPC process instance
#[tauri::command]
async fn rpc_stop(state: tauri::State<'_, RpcState>, instance_id: Option<String>) -> Result<(), String> {
    let instance_id = normalize_instance_id(instance_id);
    if let Ok(mut instances) = state.instances.lock() {
        if let Some(mut handle) = instances.remove(&instance_id) {
            stop_rpc_instance(&mut handle);
        }
        Ok(())
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Stop all RPC process instances
#[tauri::command]
async fn rpc_stop_all(state: tauri::State<'_, RpcState>) -> Result<(), String> {
    if let Ok(mut instances) = state.instances.lock() {
        for (_, mut handle) in instances.drain() {
            stop_rpc_instance(&mut handle);
        }
        Ok(())
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Check if an RPC process instance is running
#[tauri::command]
async fn rpc_is_running(state: tauri::State<'_, RpcState>, instance_id: Option<String>) -> Result<bool, String> {
    let instance_id = normalize_instance_id(instance_id);
    if let Ok(mut instances) = state.instances.lock() {
        if let Some(handle) = instances.get_mut(&instance_id) {
            if let Some(ref mut child) = handle.process {
                match child.try_wait() {
                    Ok(None) => Ok(true),
                    Ok(Some(_)) => {
                        handle.process = None;
                        handle.stdin_writer = None;
                        Ok(false)
                    }
                    Err(_) => Ok(false),
                }
            } else {
                Ok(false)
            }
        } else {
            Ok(false)
        }
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Send a response to an extension UI dialog request
#[tauri::command]
async fn rpc_ui_response(
    state: tauri::State<'_, RpcState>,
    response: String,
    instance_id: Option<String>,
) -> Result<(), String> {
    let instance_id = normalize_instance_id(instance_id);
    if let Ok(mut instances) = state.instances.lock() {
        if let Some(handle) = instances.get_mut(&instance_id) {
            if let Some(ref mut stdin) = handle.stdin_writer {
                write_rpc_line(stdin, &response)
            } else {
                Err(format!("RPC process not started for instance '{}'", instance_id))
            }
        } else {
            Err(format!("RPC process not started for instance '{}'", instance_id))
        }
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Session info for listing
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: Option<String>,
    pub path: String,
    pub cwd: Option<String>,
    pub created_at: i64,
    pub modified_at: i64,
    pub tokens: u64,
    pub cost: f64,
}

fn get_pi_agent_dir() -> Option<PathBuf> {
    // Respect explicit env override first
    if let Ok(raw) = std::env::var("PI_CODING_AGENT_DIR") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            if trimmed == "~" {
                return std::env::var_os("HOME")
                    .or(std::env::var_os("USERPROFILE"))
                    .map(PathBuf::from);
            }
            if let Some(rest) = trimmed
                .strip_prefix("~/")
                .or_else(|| trimmed.strip_prefix("~\\"))
            {
                return std::env::var_os("HOME")
                    .or(std::env::var_os("USERPROFILE"))
                    .map(|home| PathBuf::from(home).join(rest));
            }
            return Some(PathBuf::from(trimmed));
        }
    }

    // Default: ~/.pi/agent
    std::env::var_os("HOME")
        .or(std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".pi").join("agent"))
}

fn get_pi_sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(agent_dir) = get_pi_agent_dir() {
        return Ok(agent_dir.join("sessions"));
    }

    // Fallback for unusual environments
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("sessions"))
}

fn collect_session_files_recursive(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_session_files_recursive(&path, out);
            continue;
        }

        let is_jsonl = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false);

        if is_jsonl {
            out.push(path);
        }
    }
}

fn get_modified_at_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn get_created_at_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.created().ok())
        .or_else(|| fs::metadata(path).ok().and_then(|m| m.modified().ok()))
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_session_info(path: &Path) -> Option<SessionInfo> {
    let content = fs::read_to_string(path).ok()?;

    let mut id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    let mut name: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut tokens: u64 = 0;
    let mut cost: f64 = 0.0;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let entry = match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match entry.get("type").and_then(|t| t.as_str()) {
            Some("session") => {
                if let Some(session_id) = entry.get("id").and_then(|v| v.as_str()) {
                    id = session_id.to_string();
                }
                if let Some(session_cwd) = entry.get("cwd").and_then(|v| v.as_str()) {
                    let trimmed = session_cwd.trim();
                    if !trimmed.is_empty() {
                        cwd = Some(trimmed.to_string());
                    }
                }
            }
            Some("session_info") => {
                if let Some(session_name) = entry.get("name").and_then(|v| v.as_str()) {
                    let trimmed = session_name.trim();
                    if !trimmed.is_empty() {
                        name = Some(trimmed.to_string());
                    }
                }
            }
            Some("message") => {
                let message = entry.get("message");
                let role = message.and_then(|m| m.get("role")).and_then(|r| r.as_str());
                if role == Some("assistant") {
                    let message_tokens = message
                        .and_then(|m| m.get("usage"))
                        .and_then(|u| u.get("totalTokens"))
                        .and_then(|t| t.as_u64())
                        .unwrap_or(0);
                    tokens = tokens.saturating_add(message_tokens);

                    let message_cost = message
                        .and_then(|m| m.get("usage"))
                        .and_then(|u| u.get("cost"))
                        .and_then(|c| c.get("total"))
                        .and_then(|c| c.as_f64())
                        .unwrap_or(0.0);
                    cost += message_cost;
                }
            }
            _ => {}
        }
    }

    Some(SessionInfo {
        id,
        name,
        path: path.to_string_lossy().to_string(),
        cwd,
        created_at: get_created_at_ms(path),
        modified_at: get_modified_at_ms(path),
        tokens,
        cost,
    })
}

/// List all sessions from pi's session directory (~/.pi/agent/sessions)
#[tauri::command]
async fn list_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let sessions_dir = get_pi_sessions_dir(&app)?;

    if !sessions_dir.exists() {
        fs::create_dir_all(&sessions_dir)
            .map_err(|e| format!("Failed to create sessions dir: {}", e))?;
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    collect_session_files_recursive(&sessions_dir, &mut files);

    let mut sessions = files
        .iter()
        .filter_map(|path| parse_session_info(path))
        .collect::<Vec<_>>();

    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

/// Get the content of a session file
#[tauri::command]
async fn get_session_content(session_path: String) -> Result<String, String> {
    fs::read_to_string(&session_path).map_err(|e| format!("Failed to read session: {}", e))
}

#[derive(Debug, Serialize)]
struct PiAuthProviderStatus {
    provider: String,
    source: String,
    kind: String,
}

#[derive(Debug, Serialize)]
struct PiAuthStatus {
    agent_dir: Option<String>,
    auth_file: Option<String>,
    auth_file_exists: bool,
    configured_providers: Vec<PiAuthProviderStatus>,
}

fn provider_env_var_map() -> [(&'static str, &'static str); 16] {
    [
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("azure-openai-responses", "AZURE_OPENAI_API_KEY"),
        ("openai", "OPENAI_API_KEY"),
        ("google", "GEMINI_API_KEY"),
        ("mistral", "MISTRAL_API_KEY"),
        ("groq", "GROQ_API_KEY"),
        ("cerebras", "CEREBRAS_API_KEY"),
        ("xai", "XAI_API_KEY"),
        ("openrouter", "OPENROUTER_API_KEY"),
        ("vercel-ai-gateway", "AI_GATEWAY_API_KEY"),
        ("zai", "ZAI_API_KEY"),
        ("opencode", "OPENCODE_API_KEY"),
        ("huggingface", "HF_TOKEN"),
        ("kimi-coding", "KIMI_API_KEY"),
        ("minimax", "MINIMAX_API_KEY"),
        ("minimax-cn", "MINIMAX_CN_API_KEY"),
    ]
}

fn provider_env_var(provider: &str) -> Option<&'static str> {
    for (name, env_key) in provider_env_var_map() {
        if name == provider {
            return Some(env_key);
        }
    }
    None
}

fn provider_env_var_is_set(provider: &str) -> bool {
    provider_env_var(provider)
        .and_then(|env_key| std::env::var_os(env_key))
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

/// Inspect PI auth configuration from auth.json + environment variables.
#[tauri::command]
async fn get_pi_auth_status() -> Result<PiAuthStatus, String> {
    let agent_dir = get_pi_agent_dir();
    let auth_file_path = agent_dir.as_ref().map(|dir| dir.join("auth.json"));

    let mut configured_providers: Vec<PiAuthProviderStatus> = Vec::new();
    let auth_file_exists = auth_file_path
        .as_ref()
        .map(|path| path.exists() && path.is_file())
        .unwrap_or(false);

    if let Some(path) = &auth_file_path {
        if path.exists() && path.is_file() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(map) = parsed.as_object() {
                        for (provider, cred) in map {
                            let kind = cred
                                .get("type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();

                            let source = if kind == "oauth" {
                                "auth_file_oauth"
                            } else {
                                "auth_file_api_key"
                            }
                            .to_string();

                            configured_providers.push(PiAuthProviderStatus {
                                provider: provider.clone(),
                                source,
                                kind,
                            });
                        }
                    }
                }
            }
        }
    }

    // Known provider env var mapping from docs/providers.md (core API key providers)
    for (provider, env_key) in provider_env_var_map() {
        let env_present = std::env::var_os(env_key)
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        if !env_present {
            continue;
        }

        let already_listed = configured_providers.iter().any(|p| p.provider == provider);
        if already_listed {
            continue;
        }

        configured_providers.push(PiAuthProviderStatus {
            provider: provider.to_string(),
            source: "environment".to_string(),
            kind: "api_key".to_string(),
        });
    }

    configured_providers.sort_by(|a, b| a.provider.cmp(&b.provider));

    Ok(PiAuthStatus {
        agent_dir: agent_dir.map(|p| p.to_string_lossy().to_string()),
        auth_file: auth_file_path.map(|p| p.to_string_lossy().to_string()),
        auth_file_exists,
        configured_providers,
    })
}

#[derive(Debug, Serialize)]
struct PiProviderAuthClearResult {
    provider: String,
    removed: bool,
    source: String,
}

/// Remove provider credentials from ~/.pi/agent/auth.json when present.
#[tauri::command]
async fn clear_pi_provider_auth(provider: String) -> Result<PiProviderAuthClearResult, String> {
    let normalized = provider.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Provider cannot be empty".to_string());
    }

    let agent_dir = get_pi_agent_dir();
    let auth_file_path = agent_dir.as_ref().map(|dir| dir.join("auth.json"));
    let mut removed = false;

    if let Some(path) = &auth_file_path {
        if path.exists() && path.is_file() {
            let content = fs::read_to_string(path)
                .map_err(|e| format!("Failed to read auth file: {}", e))?;
            let mut parsed = serde_json::from_str::<serde_json::Value>(&content)
                .unwrap_or_else(|_| serde_json::json!({}));

            if !parsed.is_object() {
                parsed = serde_json::json!({});
            }

            if let Some(map) = parsed.as_object_mut() {
                if map.remove(&normalized).is_some() {
                    removed = true;
                    let serialized = serde_json::to_string_pretty(&parsed)
                        .map_err(|e| format!("Failed to serialize auth file: {}", e))?;
                    fs::write(path, format!("{}\n", serialized))
                        .map_err(|e| format!("Failed to write auth file: {}", e))?;

                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
                    }
                }
            }
        }
    }

    let source = if removed {
        "auth_file"
    } else if provider_env_var_is_set(&normalized) {
        "environment"
    } else {
        "missing"
    }
    .to_string();

    Ok(PiProviderAuthClearResult {
        provider: normalized,
        removed,
        source,
    })
}

#[derive(Debug, Serialize, Clone)]
struct PiOAuthProviderInfo {
    id: String,
    name: String,
    source: String,
}

fn builtin_oauth_provider_info() -> Vec<PiOAuthProviderInfo> {
    vec![
        PiOAuthProviderInfo {
            id: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            source: "built_in".to_string(),
        },
        PiOAuthProviderInfo {
            id: "github-copilot".to_string(),
            name: "GitHub Copilot".to_string(),
            source: "built_in".to_string(),
        },
        PiOAuthProviderInfo {
            id: "google-gemini-cli".to_string(),
            name: "Google Gemini CLI".to_string(),
            source: "built_in".to_string(),
        },
        PiOAuthProviderInfo {
            id: "google-antigravity".to_string(),
            name: "Google Antigravity".to_string(),
            source: "built_in".to_string(),
        },
        PiOAuthProviderInfo {
            id: "openai-codex".to_string(),
            name: "OpenAI Codex".to_string(),
            source: "built_in".to_string(),
        },
    ]
}

fn humanize_provider_id(provider_id: &str) -> String {
    provider_id
        .split(|ch: char| ch == '-' || ch == '_' || ch.is_whitespace())
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

fn parse_package_paths_from_pi_list_output(output: &str) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let candidate = PathBuf::from(trimmed);
        if !candidate.is_absolute() || !candidate.exists() || !candidate.is_dir() {
            continue;
        }

        let key = candidate.to_string_lossy().to_string();
        if seen.insert(key) {
            paths.push(candidate);
        }
    }

    paths
}

fn package_extension_entry_files(package_root: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();

    let package_json_path = package_root.join("package.json");
    if package_json_path.is_file() {
        if let Ok(content) = fs::read_to_string(&package_json_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(extensions) = parsed
                    .get("pi")
                    .and_then(|pi| pi.get("extensions"))
                    .and_then(|value| value.as_array())
                {
                    for entry in extensions {
                        let Some(raw) = entry.as_str() else {
                            continue;
                        };
                        let normalized = raw.trim().trim_start_matches("./").trim_start_matches(".\\");
                        if normalized.is_empty() {
                            continue;
                        }
                        let candidate = package_root.join(normalized);
                        if candidate.is_file() {
                            files.push(candidate);
                        }
                    }
                }
            }
        }
    }

    if files.is_empty() {
        for fallback in ["index.ts", "index.js", "src/index.ts", "src/index.js", "src/index.mjs", "index.mjs"] {
            let candidate = package_root.join(fallback);
            if candidate.is_file() {
                files.push(candidate);
            }
        }
    }

    files
}

fn parse_quoted_string(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    if index >= bytes.len() {
        return None;
    }

    let quote = bytes[index];
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    index += 1;
    let start = index;

    while index < bytes.len() {
        if bytes[index] == quote {
            return Some(value[start..index].to_string());
        }
        index += 1;
    }

    None
}

fn extract_oauth_name_from_segment(segment: &str, provider_id: &str) -> String {
    let oauth_pos = segment.find("oauth").unwrap_or(0);
    let oauth_segment = &segment[oauth_pos..];

    if let Some(name_pos) = oauth_segment.find("name") {
        let tail = &oauth_segment[name_pos + "name".len()..];
        if let Some(colon_pos) = tail.find(':') {
            let candidate = &tail[colon_pos + 1..];
            if let Some(name) = parse_quoted_string(candidate) {
                let trimmed = name.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }

    humanize_provider_id(provider_id)
}

fn extract_oauth_providers_from_source(source: &str) -> Vec<(String, String)> {
    let mut providers: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let needle = "registerProvider(";
    let mut cursor = 0usize;

    while cursor < source.len() {
        let Some(rel) = source[cursor..].find(needle) else {
            break;
        };
        let start = cursor + rel;
        let mut index = start + needle.len();
        let bytes = source.as_bytes();

        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }

        let quote = bytes[index];
        if quote != b'"' && quote != b'\'' {
            cursor = index.saturating_add(1);
            continue;
        }

        index += 1;
        let provider_start = index;
        while index < bytes.len() && bytes[index] != quote {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }

        let provider_id = source[provider_start..index].trim().to_lowercase();
        if provider_id.is_empty() {
            cursor = index.saturating_add(1);
            continue;
        }

        let segment_start = index;
        let mut scan_limit = (segment_start + 9000).min(source.len());
        while scan_limit > segment_start && !source.is_char_boundary(scan_limit) {
            scan_limit -= 1;
        }
        let segment_end = source[segment_start..scan_limit]
            .find(needle)
            .map(|next_rel| segment_start + next_rel)
            .unwrap_or(scan_limit);

        let segment = &source[segment_start..segment_end];
        if !segment.contains("oauth") {
            cursor = index.saturating_add(1);
            continue;
        }

        if seen.insert(provider_id.clone()) {
            let provider_name = extract_oauth_name_from_segment(segment, &provider_id);
            providers.push((provider_id, provider_name));
        }

        cursor = index.saturating_add(1);
    }

    providers
}

fn extract_oauth_providers_from_package(package_root: &Path) -> Vec<PiOAuthProviderInfo> {
    let mut providers: Vec<PiOAuthProviderInfo> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for file in package_extension_entry_files(package_root) {
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        for (id, name) in extract_oauth_providers_from_source(&content) {
            if !seen.insert(id.clone()) {
                continue;
            }
            providers.push(PiOAuthProviderInfo {
                id,
                name,
                source: "package".to_string(),
            });
        }
    }

    providers
}

/// Discover OAuth providers the same way users see in CLI /login:
/// built-ins + package-registered OAuth providers.
#[tauri::command]
async fn get_pi_oauth_providers(app: AppHandle) -> Result<Vec<PiOAuthProviderInfo>, String> {
    let mut providers = builtin_oauth_provider_info();
    let mut seen: HashSet<String> = providers.iter().map(|provider| provider.id.clone()).collect();

    let discovery_opts = RpcStartOptions {
        cli_path: None,
        pi_path: None,
        cwd: ".".to_string(),
        provider: None,
        model: None,
        env: None,
    };

    let Ok(pi) = discover_pi(&app, &discovery_opts) else {
        return Ok(providers);
    };

    let list_opts = PiCliCommandOptions {
        args: vec!["list".to_string()],
        cwd: Some(".".to_string()),
        env: None,
        cli_path: None,
        pi_path: None,
    };

    let output = match build_plain_command(&pi, &list_opts).output() {
        Ok(output) => output,
        Err(_) => return Ok(providers),
    };

    if !output.status.success() {
        return Ok(providers);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let package_paths = parse_package_paths_from_pi_list_output(&stdout);
    let mut custom_providers: Vec<PiOAuthProviderInfo> = Vec::new();

    for package_path in package_paths {
        for provider in extract_oauth_providers_from_package(&package_path) {
            if !seen.insert(provider.id.clone()) {
                continue;
            }
            custom_providers.push(provider);
        }
    }

    custom_providers.sort_by(|a, b| {
        let name_cmp = a.name.to_lowercase().cmp(&b.name.to_lowercase());
        if name_cmp != std::cmp::Ordering::Equal {
            return name_cmp;
        }
        a.id.cmp(&b.id)
    });

    providers.extend(custom_providers);
    Ok(providers)
}

/// Settings structure
#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub theme: String,
    pub thinking_level: String,
    pub auto_compaction: bool,
    pub auto_retry: bool,
    pub steering_mode: String,
    pub follow_up_mode: String,
    pub model_provider: Option<String>,
    pub model_id: Option<String>,
    pub pi_path: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            thinking_level: "medium".to_string(),
            auto_compaction: true,
            auto_retry: true,
            steering_mode: "one-at-a-time".to_string(),
            follow_up_mode: "one-at-a-time".to_string(),
            model_provider: None,
            model_id: None,
            pi_path: None,
        }
    }
}

/// Save app settings
#[tauri::command]
async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure directory exists
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;

    let settings_path = data_dir.join("settings.json");
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(settings_path, json).map_err(|e| format!("Failed to write settings: {}", e))
}

/// Load app settings
#[tauri::command]
async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let settings_path = data_dir.join("settings.json");

    if !settings_path.exists() {
        return Ok(AppSettings::default());
    }

    let content =
        fs::read_to_string(settings_path).map_err(|e| format!("Failed to read settings: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))
}

/// Open a file dialog and return the selected path
#[tauri::command]
async fn open_file_dialog(_app: AppHandle, _multiple: bool) -> Result<Vec<String>, String> {
    // Placeholder: frontend currently uses @tauri-apps/plugin-dialog directly.
    Ok(Vec::new())
}

#[derive(Debug, Deserialize)]
struct PiCliCommandOptions {
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
    cli_path: Option<String>,
    pi_path: Option<String>,
}

#[derive(Debug, Serialize)]
struct PiCliCommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    discovery: String,
}

#[derive(Debug, Deserialize)]
struct CliStatusOptions {
    cli_path: Option<String>,
    pi_path: Option<String>,
    cwd: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
struct CliUpdateStatus {
    discovery: String,
    current_version: Option<String>,
    latest_version: Option<String>,
    update_available: bool,
    can_update_in_app: bool,
    npm_available: bool,
    update_command: String,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
struct PiChangelogResult {
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct NpmCommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

#[derive(Debug, Deserialize)]
struct GitCommandOptions {
    args: Vec<String>,
    cwd: Option<String>,
}

#[derive(Debug, Serialize)]
struct GitCommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

#[derive(Debug, Deserialize)]
struct ShareGistOptions {
    html_path: String,
}

#[derive(Debug, Serialize)]
struct ShareGistResult {
    gist_url: String,
    gist_id: String,
    preview_url: String,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
struct DesktopRuntimeInfo {
    platform: String,
    arch: String,
    version: String,
}

fn npm_executable() -> &'static str {
    if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn discover_gh_path() -> Option<PathBuf> {
    if let Ok(path) = which::which("gh") {
        return Some(path);
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(&app_data).join("GitHub CLI").join("gh.exe"));
            candidates.push(PathBuf::from(&app_data).join("npm").join("gh.cmd"));
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("GitHub CLI").join("gh.exe"));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(program_files_x86).join("GitHub CLI").join("gh.exe"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/gh"));
        candidates.push(PathBuf::from("/usr/local/bin/gh"));
        candidates.push(PathBuf::from("/usr/bin/gh"));
        if let Some(home_dir) = resolve_home_dir() {
            candidates.push(home_dir.join(".local/bin/gh"));
            candidates.push(home_dir.join(".nvm/versions/node/current/bin/gh"));
        }
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn parse_gist_url_from_output(output: &str) -> Option<String> {
    for token in output.split_whitespace() {
        let Some(start) = token.find("https://gist.github.com/") else {
            continue;
        };
        let mut url = token[start..]
            .trim_matches(|c: char| c == '"' || c == '\'' || c == '`' || c == '(' || c == '[' || c == '{')
            .to_string();

        while let Some(last) = url.chars().last() {
            if matches!(last, ')' | ']' | '}' | ',' | ';' | '.') {
                url.pop();
                continue;
            }
            break;
        }

        if !url.is_empty() {
            return Some(url);
        }
    }
    None
}

fn parse_gist_id_from_url(url: &str) -> Option<String> {
    let clean = url.trim().trim_end_matches('/');
    let parts: Vec<&str> = clean.split('/').filter(|entry| !entry.trim().is_empty()).collect();
    let gist_id = parts.last()?.trim();
    if gist_id.len() < 20 {
        return None;
    }
    if !gist_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(gist_id.to_string())
}

fn sanitize_version_token(raw: &str) -> String {
    raw.trim_matches(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-'))
        .to_string()
}

fn is_semverish(token: &str) -> bool {
    let core = token.split('-').next().unwrap_or(token);
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() < 2 {
        return false;
    }

    parts
        .iter()
        .take(3)
        .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn parse_semver_tuple(version: &str) -> Option<(u64, u64, u64)> {
    let core = version.split('-').next().unwrap_or(version);
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    match (parse_semver_tuple(latest), parse_semver_tuple(current)) {
        (Some(lat), Some(cur)) => lat > cur,
        _ => latest.trim() != current.trim(),
    }
}

fn extract_version_from_output(output: &str) -> Option<String> {
    for raw in output.split_whitespace() {
        let token = sanitize_version_token(raw);
        if token.is_empty() {
            continue;
        }

        let normalized = token.strip_prefix('v').unwrap_or(&token);
        if is_semverish(normalized) {
            return Some(normalized.to_string());
        }
    }

    None
}

fn get_current_pi_version(pi: &PiProcess, options: &CliStatusOptions) -> Option<String> {
    let version_opts = PiCliCommandOptions {
        args: vec!["--version".to_string()],
        cwd: options.cwd.clone(),
        env: options.env.clone(),
        cli_path: options.cli_path.clone(),
        pi_path: options.pi_path.clone(),
    };

    let output = build_plain_command(pi, &version_opts).output().ok()?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    extract_version_from_output(&combined)
}

fn get_latest_npm_cli_version(pi: Option<&PiProcess>) -> (bool, Option<String>, Option<String>) {
    let npm_path = match discover_npm_path(pi) {
        Some(path) => path,
        None => {
            return (false, None, Some("npm not found on PATH/common locations".to_string()));
        }
    };

    let mut cmd = Command::new(&npm_path);
    cmd.arg("view")
        .arg("@mariozechner/pi-coding-agent")
        .arg("version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(parent) = npm_path.parent() {
        prepend_bin_dir_to_path(&mut cmd, parent);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = match cmd.output() {
        Ok(out) => out,
        Err(err) => {
            return (true, None, Some(format!("Failed to run npm: {}", err)));
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let error = if stderr.is_empty() {
            "npm returned an error while checking latest version".to_string()
        } else {
            stderr
        };
        return (true, None, Some(error));
    }

    let latest = extract_version_from_output(&stdout).or_else(|| {
        if stdout.is_empty() {
            None
        } else {
            Some(stdout)
        }
    });

    if latest.is_none() {
        return (
            true,
            None,
            Some("Could not parse latest CLI version from npm output".to_string()),
        );
    }

    (true, latest, None)
}

fn build_plain_command(pi: &PiProcess, options: &PiCliCommandOptions) -> Command {
    let mut cmd = match pi {
        PiProcess::DevNode { script } => {
            let mut c = Command::new("node");
            c.arg(script);
            c
        }
        PiProcess::SidecarBinary { path } | PiProcess::PathBinary { path } => Command::new(path),
    };

    for arg in &options.args {
        cmd.arg(arg);
    }

    if let Some(cwd) = &options.cwd {
        cmd.current_dir(cwd);
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(env) = &options.env {
        for (key, value) in env {
            cmd.env(key, value);
        }
    }

    if let PiProcess::PathBinary { path } = pi {
        if let Some(parent) = path.parent() {
            prepend_bin_dir_to_path(&mut cmd, parent);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd
}

/// Run a regular pi CLI command (e.g. package operations: list/install/remove/update)
#[tauri::command]
async fn run_pi_cli_command(
    app: AppHandle,
    options: PiCliCommandOptions,
) -> Result<PiCliCommandResult, String> {
    if options.args.is_empty() {
        return Err("No command arguments provided".to_string());
    }

    let resolved_cwd = options.cwd.clone().unwrap_or_else(|| ".".to_string());
    if !Path::new(&resolved_cwd).is_dir() {
        return Err(format!("Working directory does not exist: {}", resolved_cwd));
    }

    let discovery_opts = RpcStartOptions {
        cli_path: options.cli_path.clone(),
        pi_path: options.pi_path.clone(),
        cwd: resolved_cwd,
        provider: None,
        model: None,
        env: options.env.clone(),
    };

    let pi = discover_pi(&app, &discovery_opts)?;
    let discovery_label = format!("{:?}", pi);

    let output = build_plain_command(&pi, &options)
        .output()
        .map_err(|e| format!("Failed to run pi command ({:?}): {}", pi, e))?;

    Ok(PiCliCommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        discovery: discovery_label,
    })
}

/// Get current vs latest CLI version and whether in-app update is available.
#[tauri::command]
async fn get_cli_update_status(
    app: AppHandle,
    options: Option<CliStatusOptions>,
) -> Result<CliUpdateStatus, String> {
    let opts = options.unwrap_or(CliStatusOptions {
        cli_path: None,
        pi_path: None,
        cwd: Some(".".to_string()),
        env: None,
    });

    let discovery_opts = RpcStartOptions {
        cli_path: opts.cli_path.clone(),
        pi_path: opts.pi_path.clone(),
        cwd: opts.cwd.clone().unwrap_or_else(|| ".".to_string()),
        provider: None,
        model: None,
        env: opts.env.clone(),
    };

    let pi = discover_pi(&app, &discovery_opts)?;
    let discovery = format!("{:?}", pi);
    let current_version = get_current_pi_version(&pi, &opts);

    let (npm_available, latest_version, npm_note) = get_latest_npm_cli_version(Some(&pi));

    let can_update_in_app = matches!(pi, PiProcess::PathBinary { .. });
    let update_command = "npm install -g @mariozechner/pi-coding-agent@latest".to_string();

    let update_available = match (&current_version, &latest_version) {
        (Some(current), Some(latest)) if can_update_in_app => is_newer_version(latest, current),
        _ => false,
    };

    let note = if let Some(note) = npm_note {
        Some(note)
    } else if matches!(pi, PiProcess::SidecarBinary { .. }) {
        Some(
            "Using bundled sidecar binary; update the desktop app bundle to update CLI".to_string(),
        )
    } else if matches!(pi, PiProcess::DevNode { .. }) {
        Some("Using a dev CLI path; update your local coding-agent checkout".to_string())
    } else if !can_update_in_app {
        Some("Current CLI source is not updatable from inside desktop".to_string())
    } else {
        None
    };

    Ok(CliUpdateStatus {
        discovery,
        current_version,
        latest_version,
        update_available,
        can_update_in_app,
        npm_available,
        update_command,
        note,
    })
}

#[tauri::command]
async fn get_pi_changelog(
    app: AppHandle,
    options: Option<CliStatusOptions>,
) -> Result<PiChangelogResult, String> {
    let opts = options.unwrap_or(CliStatusOptions {
        cli_path: None,
        pi_path: None,
        cwd: Some(".".to_string()),
        env: None,
    });

    let discovery_opts = RpcStartOptions {
        cli_path: opts.cli_path.clone(),
        pi_path: opts.pi_path.clone(),
        cwd: opts.cwd.clone().unwrap_or_else(|| ".".to_string()),
        provider: None,
        model: None,
        env: opts.env.clone(),
    };

    let pi = discover_pi(&app, &discovery_opts)?;
    let candidates = resolve_pi_changelog_candidates(&pi);
    let mut seen = HashSet::new();

    for candidate in candidates {
        let raw = candidate.to_string_lossy().to_string();
        if raw.trim().is_empty() || !seen.insert(raw.clone()) {
            continue;
        }
        if !candidate.is_file() {
            continue;
        }

        match fs::read_to_string(&candidate) {
            Ok(content) => {
                return Ok(PiChangelogResult {
                    path: raw,
                    content,
                });
            }
            Err(_) => {
                continue;
            }
        }
    }

    Err(format!(
        "Could not locate Pi Coding Agent changelog for discovery: {:?}",
        pi
    ))
}

/// Update globally installed pi CLI via npm.
#[tauri::command]
async fn update_cli_via_npm() -> Result<NpmCommandResult, String> {
    let npm_path = discover_npm_path(None)
        .ok_or_else(|| "npm was not found on PATH/common locations. Install Node.js/npm first.".to_string())?;

    let mut cmd = Command::new(&npm_path);
    cmd.arg("install")
        .arg("-g")
        .arg("@mariozechner/pi-coding-agent@latest")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(parent) = npm_path.parent() {
        prepend_bin_dir_to_path(&mut cmd, parent);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run npm update command: {}", e))?;

    Ok(NpmCommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

#[tauri::command]
async fn run_git_command(options: GitCommandOptions) -> Result<GitCommandResult, String> {
    if options.args.is_empty() {
        return Err("No git command arguments provided".to_string());
    }

    let git_path = which::which("git").map_err(|_| "git was not found on PATH".to_string())?;

    let mut cmd = Command::new(git_path);
    cmd.args(&options.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cwd) = options.cwd {
        cmd.current_dir(cwd);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git command: {}", e))?;

    Ok(GitCommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

#[tauri::command]
async fn create_share_gist(options: ShareGistOptions) -> Result<ShareGistResult, String> {
    let html_path_raw = options.html_path.trim();
    if html_path_raw.is_empty() {
        return Err("No export file path provided".to_string());
    }

    let html_path = PathBuf::from(html_path_raw);
    if !html_path.is_file() {
        return Err(format!("Exported session file not found: {}", html_path_raw));
    }

    let gh_path = discover_gh_path().ok_or_else(|| {
        "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/".to_string()
    })?;

    let mut auth_cmd = Command::new(&gh_path);
    auth_cmd
        .arg("auth")
        .arg("status")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        auth_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let auth_output = auth_cmd
        .output()
        .map_err(|e| format!("Failed to run gh auth status: {}", e))?;

    if !auth_output.status.success() {
        return Err("GitHub CLI is not logged in. Run 'gh auth login' first.".to_string());
    }

    let mut gist_cmd = Command::new(&gh_path);
    gist_cmd
        .arg("gist")
        .arg("create")
        .arg("--public=false")
        .arg(&html_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(parent) = html_path.parent() {
        gist_cmd.current_dir(parent);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        gist_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let gist_output = gist_cmd
        .output()
        .map_err(|e| format!("Failed to run gh gist create: {}", e))?;

    let stdout = String::from_utf8_lossy(&gist_output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&gist_output.stderr).to_string();

    if !gist_output.status.success() {
        let message = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!("gh gist create failed with exit code {}", gist_output.status.code().unwrap_or(-1))
        };
        return Err(format!("Failed to create gist: {}", message));
    }

    let combined = format!("{}\n{}", stdout, stderr);
    let gist_url = parse_gist_url_from_output(&combined)
        .ok_or_else(|| "Failed to parse gist URL from gh output".to_string())?;
    let gist_id = parse_gist_id_from_url(&gist_url)
        .ok_or_else(|| "Failed to parse gist ID from gh output".to_string())?;
    let preview_url = format!("https://pi.dev/session/#{}", gist_id);

    Ok(ShareGistResult {
        gist_url,
        gist_id,
        preview_url,
        stdout,
        stderr,
    })
}

#[tauri::command]
async fn get_desktop_runtime_info(app: AppHandle) -> Result<DesktopRuntimeInfo, String> {
    Ok(DesktopRuntimeInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
async fn open_path_in_default_app(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("No path provided".to_string());
    }

    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", trimmed));
    }

    #[cfg(target_os = "macos")]
    {
        let primary = Command::new("open")
            .arg(&target)
            .output()
            .map_err(|e| format!("Failed to launch open command: {}", e))?;

        if primary.status.success() {
            return Ok(());
        }

        // Some files (e.g. .sample hooks in .git) have no associated app.
        // Fall back to TextEdit so "Open in editor" still works.
        let fallback = Command::new("open")
            .arg("-a")
            .arg("TextEdit")
            .arg(&target)
            .output()
            .map_err(|e| format!("Failed to launch TextEdit fallback: {}", e))?;

        if fallback.status.success() {
            return Ok(());
        }

        let primary_stderr = String::from_utf8_lossy(&primary.stderr).trim().to_string();
        let fallback_stderr = String::from_utf8_lossy(&fallback.stderr).trim().to_string();
        return Err(format!(
            "Could not open file. default-app error: {} | TextEdit fallback error: {}",
            if primary_stderr.is_empty() {
                format!("exit code {}", primary.status.code().unwrap_or(-1))
            } else {
                primary_stderr
            },
            if fallback_stderr.is_empty() {
                format!("exit code {}", fallback.status.code().unwrap_or(-1))
            } else {
                fallback_stderr
            }
        ));
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("xdg-open")
            .arg(&target)
            .output()
            .map_err(|e| format!("Failed to launch xdg-open command: {}", e))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Could not open file (exit code {})", output.status.code().unwrap_or(-1))
        } else {
            format!("Could not open file: {}", stderr)
        });
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(target.as_os_str())
            .output()
            .map_err(|e| format!("Failed to launch start command: {}", e))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Could not open file (exit code {})", output.status.code().unwrap_or(-1))
        } else {
            format!("Could not open file: {}", stderr)
        });
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for open_path_in_default_app".to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
                    let _ = window.set_shadow(true);
                }
            }
            Ok(())
        })
        .manage(RpcState::default())
        .invoke_handler(tauri::generate_handler![
            rpc_start,
            rpc_send,
            rpc_stop,
            rpc_stop_all,
            rpc_is_running,
            rpc_ui_response,
            list_sessions,
            get_session_content,
            get_pi_auth_status,
            get_pi_oauth_providers,
            clear_pi_provider_auth,
            save_settings,
            load_settings,
            open_file_dialog,
            run_pi_cli_command,
            get_cli_update_status,
            get_pi_changelog,
            update_cli_via_npm,
            run_git_command,
            create_share_gist,
            get_desktop_runtime_info,
            open_path_in_default_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
