use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager};

/// State for managing the RPC child process
pub struct RpcState {
    process: Arc<Mutex<Option<Child>>>,
    stdin_writer: Arc<Mutex<Option<std::process::ChildStdin>>>,
}

impl Default for RpcState {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            stdin_writer: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct RpcStartOptions {
    /// Dev-mode only: path to the CLI JS file (e.g. "../coding-agent/dist/cli.js").
    /// When null/empty, the backend discovers the pi binary automatically.
    cli_path: Option<String>,
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

/// Discover the pi binary. Strategy:
/// 1. If cli_path is provided (dev mode), use node + script
/// 2. Try sidecar discovery (packaged app)
/// 3. Try finding `pi` on PATH (globally installed CLI or standalone binary)
/// 4. Fail with actionable error
fn discover_pi(app: &AppHandle, options: &RpcStartOptions) -> Result<PiProcess, String> {
    // Dev mode: cli_path explicitly provided
    if let Some(ref cli_path) = options.cli_path {
        if !cli_path.is_empty() {
            return Ok(PiProcess::DevNode {
                script: cli_path.clone(),
            });
        }
    }

    // Packaged app: bundled sidecar
    if let Some(path) = discover_sidecar(app) {
        return Ok(PiProcess::SidecarBinary { path });
    }

    // Fallback: pi on PATH
    if let Ok(path) = which::which("pi") {
        return Ok(PiProcess::PathBinary { path });
    }

    Err("Could not find the pi CLI.\n\n\
         Install it with:\n  npm install -g @mariozechner/pi-coding-agent\n\n\
         Then restart the app."
        .to_string())
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

    // On Windows, prevent console window from appearing
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd
}

/// Start the pi coding agent in RPC mode as a child process.
/// Discovery order: dev cli_path -> sidecar -> PATH -> error.
#[tauri::command]
async fn rpc_start(
    app: AppHandle,
    state: tauri::State<'_, RpcState>,
    options: RpcStartOptions,
) -> Result<String, String> {
    // Kill existing process if any
    if let Ok(mut proc) = state.process.lock() {
        if let Some(mut child) = proc.take() {
            let _ = child.kill();
        }
    }

    let pi = discover_pi(&app, &options)?;
    let discovery_label = format!("{:?}", pi);

    let mut cmd = build_command(&pi, &options);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn pi process ({:?}): {}", pi, e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    // Store stdin writer for sending commands
    if let Ok(mut writer) = state.stdin_writer.lock() {
        *writer = Some(stdin);
    }

    // Store process handle
    if let Ok(mut proc) = state.process.lock() {
        *proc = Some(child);
    }

    // Spawn thread to read stdout and emit events to frontend
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let _ = app_handle.emit("rpc-event", &line);
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit("rpc-closed", "process exited");
    });

    // Spawn thread to read stderr
    let app_handle_err = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = app_handle_err.emit("rpc-stderr", &line);
                }
                Err(_) => break,
            }
        }
    });

    Ok(discovery_label)
}

/// Send a JSON command to the RPC process stdin
#[tauri::command]
async fn rpc_send(state: tauri::State<'_, RpcState>, command: String) -> Result<(), String> {
    if let Ok(mut writer) = state.stdin_writer.lock() {
        if let Some(ref mut stdin) = *writer {
            stdin
                .write_all(command.as_bytes())
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin
                .write_all(b"\n")
                .map_err(|e| format!("Failed to write newline: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            Ok(())
        } else {
            Err("RPC process not started".to_string())
        }
    } else {
        Err("Failed to acquire stdin lock".to_string())
    }
}

/// Stop the RPC process
#[tauri::command]
async fn rpc_stop(state: tauri::State<'_, RpcState>) -> Result<(), String> {
    // Drop stdin first to signal EOF
    if let Ok(mut writer) = state.stdin_writer.lock() {
        *writer = None;
    }

    // Kill process
    if let Ok(mut proc) = state.process.lock() {
        if let Some(mut child) = proc.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    Ok(())
}

/// Check if the RPC process is running
#[tauri::command]
async fn rpc_is_running(state: tauri::State<'_, RpcState>) -> Result<bool, String> {
    if let Ok(mut proc) = state.process.lock() {
        if let Some(ref mut child) = *proc {
            match child.try_wait() {
                Ok(None) => Ok(true),
                Ok(Some(_)) => Ok(false),
                Err(_) => Ok(false),
            }
        } else {
            Ok(false)
        }
    } else {
        Ok(false)
    }
}

/// Send a response to an extension UI dialog request
#[tauri::command]
async fn rpc_ui_response(
    state: tauri::State<'_, RpcState>,
    response: String,
) -> Result<(), String> {
    if let Ok(mut writer) = state.stdin_writer.lock() {
        if let Some(ref mut stdin) = *writer {
            stdin
                .write_all(response.as_bytes())
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin
                .write_all(b"\n")
                .map_err(|e| format!("Failed to write newline: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            Ok(())
        } else {
            Err("RPC process not started".to_string())
        }
    } else {
        Err("Failed to acquire stdin lock".to_string())
    }
}

/// Get the app's data directory for storing config/sessions
#[tauri::command]
fn get_app_data_dir(app: AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// Session info for listing
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: Option<String>,
    pub path: String,
    pub cwd: Option<String>,
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
    let provider_env_map = [
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
    ];

    for (provider, env_key) in provider_env_map {
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
struct NpmCommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

fn npm_executable() -> &'static str {
    if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    }
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
    };

    let output = build_plain_command(pi, &version_opts).output().ok()?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    extract_version_from_output(&combined)
}

fn get_latest_npm_cli_version() -> (bool, Option<String>, Option<String>) {
    let npm = npm_executable();
    let npm_path = match which::which(npm) {
        Ok(path) => path,
        Err(_) => {
            return (false, None, Some("npm not found on PATH".to_string()));
        }
    };

    let mut cmd = Command::new(npm_path);
    cmd.arg("view")
        .arg("@mariozechner/pi-coding-agent")
        .arg("version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

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

    let discovery_opts = RpcStartOptions {
        cli_path: options.cli_path.clone(),
        cwd: options.cwd.clone().unwrap_or_else(|| ".".to_string()),
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

#[derive(Debug, Serialize)]
struct ProjectGitStatus {
    inside_repo: bool,
    branch: Option<String>,
    detached: bool,
    dirty: bool,
}

#[derive(Debug, Serialize)]
struct GitBranchEntry {
    name: String,
    current: bool,
}

fn run_git_command(project_path: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd.output()
        .map_err(|e| format!("Failed to run git {:?} in {}: {}", args, project_path, e))
}

/// Read git branch/dirty state for a project path.
#[tauri::command]
async fn get_project_git_status(project_path: String) -> Result<ProjectGitStatus, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Ok(ProjectGitStatus {
            inside_repo: false,
            branch: None,
            detached: false,
            dirty: false,
        });
    }

    let inside_repo = run_git_command(trimmed, &["rev-parse", "--is-inside-work-tree"])
        .ok()
        .map(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).trim().eq_ignore_ascii_case("true")
        })
        .unwrap_or(false);

    if !inside_repo {
        return Ok(ProjectGitStatus {
            inside_repo: false,
            branch: None,
            detached: false,
            dirty: false,
        });
    }

    let mut branch = run_git_command(trimmed, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .and_then(|output| {
            if !output.status.success() {
                return None;
            }
            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if value.is_empty() {
                None
            } else {
                Some(value)
            }
        });

    let mut detached = matches!(branch.as_deref(), Some("HEAD"));
    if detached {
        branch = run_git_command(trimmed, &["rev-parse", "--short", "HEAD"])
            .ok()
            .and_then(|output| {
                if !output.status.success() {
                    return None;
                }
                let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if value.is_empty() {
                    None
                } else {
                    Some(value)
                }
            });
    }

    if branch.is_none() {
        detached = false;
    }

    let dirty = run_git_command(trimmed, &["status", "--porcelain"])
        .ok()
        .map(|output| {
            output.status.success() && !String::from_utf8_lossy(&output.stdout).trim().is_empty()
        })
        .unwrap_or(false);

    Ok(ProjectGitStatus {
        inside_repo: true,
        branch,
        detached,
        dirty,
    })
}

/// List local git branches for a project path.
#[tauri::command]
async fn list_project_git_branches(project_path: String) -> Result<Vec<GitBranchEntry>, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let inside_repo = run_git_command(trimmed, &["rev-parse", "--is-inside-work-tree"])
        .ok()
        .map(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).trim().eq_ignore_ascii_case("true")
        })
        .unwrap_or(false);

    if !inside_repo {
        return Ok(Vec::new());
    }

    let output = run_git_command(
        trimmed,
        &["branch", "--format", "%(refname:short)|%(HEAD)"],
    )?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Failed to list git branches".to_string()
        } else {
            stderr
        });
    }

    let mut branches = Vec::new();
    for raw_line in String::from_utf8_lossy(&output.stdout).lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('|');
        let name = parts.next().unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        let head_marker = parts.next().unwrap_or("").trim();
        branches.push(GitBranchEntry {
            name: name.to_string(),
            current: head_marker == "*",
        });
    }

    Ok(branches)
}

/// Switch current git branch for project path.
#[tauri::command]
async fn switch_project_git_branch(project_path: String, branch: String) -> Result<(), String> {
    let trimmed_path = project_path.trim();
    let trimmed_branch = branch.trim();
    if trimmed_path.is_empty() {
        return Err("Project path is required".to_string());
    }
    if trimmed_branch.is_empty() {
        return Err("Branch name is required".to_string());
    }

    let output = run_git_command(trimmed_path, &["checkout", trimmed_branch])?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("Failed to switch to branch '{}'", trimmed_branch)
    };

    Err(message)
}

/// Get current vs latest CLI version and whether in-app update is available.
#[tauri::command]
async fn get_cli_update_status(
    app: AppHandle,
    options: Option<CliStatusOptions>,
) -> Result<CliUpdateStatus, String> {
    let opts = options.unwrap_or(CliStatusOptions {
        cli_path: None,
        cwd: Some(".".to_string()),
        env: None,
    });

    let discovery_opts = RpcStartOptions {
        cli_path: opts.cli_path.clone(),
        cwd: opts.cwd.clone().unwrap_or_else(|| ".".to_string()),
        provider: None,
        model: None,
        env: opts.env.clone(),
    };

    let pi = discover_pi(&app, &discovery_opts)?;
    let discovery = format!("{:?}", pi);
    let current_version = get_current_pi_version(&pi, &opts);

    let (npm_available, latest_version, npm_note) = get_latest_npm_cli_version();

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

/// Update globally installed pi CLI via npm.
#[tauri::command]
async fn update_cli_via_npm() -> Result<NpmCommandResult, String> {
    let npm = npm_executable();
    let npm_path = which::which(npm)
        .map_err(|_| "npm was not found on PATH. Install Node.js/npm first.".to_string())?;

    let mut cmd = Command::new(npm_path);
    cmd.arg("install")
        .arg("-g")
        .arg("@mariozechner/pi-coding-agent@latest")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RpcState::default())
        .invoke_handler(tauri::generate_handler![
            rpc_start,
            rpc_send,
            rpc_stop,
            rpc_is_running,
            get_app_data_dir,
            rpc_ui_response,
            list_sessions,
            get_session_content,
            get_pi_auth_status,
            save_settings,
            load_settings,
            open_file_dialog,
            run_pi_cli_command,
            get_project_git_status,
            list_project_git_branches,
            switch_project_git_branch,
            get_cli_update_status,
            update_cli_via_npm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
