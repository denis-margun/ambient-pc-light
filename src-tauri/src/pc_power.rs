//! Sync WLED power with the PC: lights on when Windows starts (or wakes up),
//! lights off when Windows shuts down (or goes to sleep).
//!
//! Shutdown is detected by subclassing the main window and handling
//! `WM_ENDSESSION` / `WM_POWERBROADCAST`. Requests are sent with plain blocking
//! sockets because the async runtime may already be going away at that point.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

/// Command-line flag passed by the autostart entry.
pub const AUTOSTART_ARG: &str = "--autostart";
/// After boot/wake the network may need a while to come up.
const POWER_ON_RETRY_FOR: Duration = Duration::from_secs(90);
const POWER_ON_RETRY_EVERY: Duration = Duration::from_secs(3);
/// Windows gives us ~5 s on shutdown; keep well below that.
const SHUTDOWN_BUDGET: Duration = Duration::from_millis(2500);
/// On sleep/hibernate the app only gets ~2 s before Windows suspends anyway.
const SUSPEND_BUDGET: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcPowerConfig {
    /// Devices to turn on when Windows starts / wakes up.
    pub on_ips: Vec<String>,
    /// Devices to turn off when Windows shuts down / goes to sleep.
    pub off_ips: Vec<String>,
}

#[derive(Default)]
pub struct PcPower {
    /// The "lights on at boot" action runs once, on the first config sync.
    boot_handled: Mutex<bool>,
}

fn global() -> &'static Mutex<PcPowerConfig> {
    static CFG: OnceLock<Mutex<PcPowerConfig>> = OnceLock::new();
    CFG.get_or_init(Default::default)
}

pub fn launched_by_autostart() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

/// Minimal `POST /json/state` with a blocking socket.
fn post_state(host: &str, body: &str, timeout: Duration) -> Result<(), String> {
    let addr_str = if host.contains(':') && !host.starts_with('[') { host.to_string() } else { format!("{host}:80") };
    let addrs: Vec<_> = addr_str.to_socket_addrs().map_err(|e| e.to_string())?.collect();
    let addr = addrs.first().ok_or("no address")?;
    let mut s = TcpStream::connect_timeout(addr, timeout).map_err(|e| e.to_string())?;
    s.set_write_timeout(Some(timeout)).ok();
    s.set_read_timeout(Some(timeout)).ok();
    let host_header = host.split(':').next().unwrap_or(host);
    let req = format!(
        "POST /json/state HTTP/1.1\r\nHost: {host_header}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 16];
    let n = s.read(&mut buf).map_err(|e| e.to_string())?;
    if buf[..n].starts_with(b"HTTP/1.1 2") || buf[..n].starts_with(b"HTTP/1.0 2") {
        Ok(())
    } else {
        Err("bad response".into())
    }
}

/// Turn every device off in parallel, returning within `budget`.
fn power_off_all(budget: Duration) {
    let cfg = global().lock().unwrap().clone();
    if cfg.off_ips.is_empty() {
        return;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    for ip in cfg.off_ips.clone() {
        let tx = tx.clone();
        thread::spawn(move || {
            let _ = post_state(&ip, r#"{"on":false}"#, budget.mul_f32(0.6));
            let _ = tx.send(());
        });
    }
    drop(tx);
    let deadline = Instant::now() + budget;
    for _ in 0..cfg.off_ips.len() {
        let left = deadline.saturating_duration_since(Instant::now());
        if rx.recv_timeout(left).is_err() {
            break;
        }
    }
}

/// Turn every device on, retrying while the network comes up.
fn power_on_all_in_background() {
    let cfg = global().lock().unwrap().clone();
    for ip in cfg.on_ips {
        thread::spawn(move || {
            let start = Instant::now();
            while start.elapsed() < POWER_ON_RETRY_FOR {
                if post_state(&ip, r#"{"on":true}"#, Duration::from_millis(2000)).is_ok() {
                    return;
                }
                thread::sleep(POWER_ON_RETRY_EVERY);
            }
        });
    }
}

/// Called by the frontend whenever settings or the device list change.
#[tauri::command]
pub fn set_pc_power(app: AppHandle, state: State<'_, PcPower>, config: PcPowerConfig) -> Result<(), String> {
    *global().lock().unwrap() = config.clone();

    let autolaunch = app.autolaunch();
    let want = !config.on_ips.is_empty() || !config.off_ips.is_empty();
    if autolaunch.is_enabled().unwrap_or(false) != want {
        if want { autolaunch.enable() } else { autolaunch.disable() }.map_err(|e| e.to_string())?;
    }

    let mut boot = state.boot_handled.lock().unwrap();
    if !*boot {
        *boot = true;
        if launched_by_autostart() {
            power_on_all_in_background();
        }
    }
    Ok(())
}

#[cfg(windows)]
pub fn install_hooks(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        PBT_APMRESUMEAUTOMATIC, PBT_APMSUSPEND, WM_ENDSESSION, WM_POWERBROADCAST,
    };

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
        match msg {
            // wParam != 0 → the session really ends (shutdown / restart / log off)
            WM_ENDSESSION if wp != 0 => power_off_all(SHUTDOWN_BUDGET),
            // sent for both sleep (S3) and hibernate
            WM_POWERBROADCAST if wp == PBT_APMSUSPEND as usize => power_off_all(SUSPEND_BUDGET),
            WM_POWERBROADCAST if wp == PBT_APMRESUMEAUTOMATIC as usize => power_on_all_in_background(),
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wp, lp)
    }

    if let Ok(h) = window.hwnd() {
        unsafe {
            SetWindowSubclass(h.0 as HWND, Some(proc), 0x574c4544, 0);
        }
    }
}

#[cfg(not(windows))]
pub fn install_hooks(_window: &tauri::WebviewWindow) {}
