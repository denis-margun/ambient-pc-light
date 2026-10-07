//! Ambient PC Light — Rust backend.
//!
//! * Discovery: mDNS (`_wled._tcp.local.`) + optional /24 subnet scan of every
//!   local IPv4 interface, each candidate is verified via `GET /json/info`.
//! * Control: thin HTTP proxy to the WLED JSON API (no CORS issues in the webview).

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use serde::Serialize;
use serde_json::Value;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tokio::sync::Mutex;

mod pc_power;

const MDNS_SERVICE: &str = "_wled._tcp.local.";
const FOUND_EVENT: &str = "wled://found";

struct Http {
    /// Client for regular control requests.
    control: reqwest::Client,
    /// Client with aggressive timeouts for probing hosts while scanning.
    probe: reqwest::Client,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundDevice {
    pub ip: String,
    pub name: String,
    pub mac: String,
    pub version: String,
    pub led_count: u64,
    pub source: String,
}

fn valid_host(ip: &str) -> Result<(), String> {
    // Allow IPv4/IPv6 or a plain hostname (e.g. wled-kitchen.local), nothing that could alter the URL.
    let ok = !ip.is_empty()
        && ip.len() <= 253
        && ip
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '_'));
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid address: {ip}"))
    }
}

fn valid_path(path: &str) -> Result<(), String> {
    if path.starts_with("/json") || path == "/presets.json" {
        Ok(())
    } else {
        Err(format!("Invalid path: {path}"))
    }
}

async fn probe(client: &reqwest::Client, ip: &str, source: &str) -> Option<FoundDevice> {
    let url = format!("http://{ip}/json/info");
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let info: Value = resp.json().await.ok()?;
    let is_wled = info.get("brand").and_then(Value::as_str) == Some("WLED")
        || (info.get("ver").is_some() && info.get("leds").is_some());
    if !is_wled {
        return None;
    }
    Some(FoundDevice {
        ip: ip.to_string(),
        name: info
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("WLED")
            .to_string(),
        mac: info
            .get("mac")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        version: info
            .get("ver")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        led_count: info
            .pointer("/leds/count")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        source: source.to_string(),
    })
}

/// Browse mDNS for `duration` and return the IPv4 addresses that announced WLED.
fn mdns_browse(duration: Duration) -> Vec<String> {
    let mut ips: Vec<String> = Vec::new();
    let Ok(daemon) = mdns_sd::ServiceDaemon::new() else {
        return ips;
    };
    let Ok(rx) = daemon.browse(MDNS_SERVICE) else {
        let _ = daemon.shutdown();
        return ips;
    };
    let deadline = std::time::Instant::now() + duration;
    loop {
        let now = std::time::Instant::now();
        if now >= deadline {
            break;
        }
        match rx.recv_timeout(deadline - now) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                for addr in info.get_addresses().iter() {
                    let s = addr.to_string();
                    // keep IPv4 only — WLED's HTTP server is reachable over v4
                    if s.parse::<Ipv4Addr>().is_ok() && !ips.contains(&s) {
                        ips.push(s);
                    }
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.stop_browse(MDNS_SERVICE);
    let _ = daemon.shutdown();
    ips
}

fn is_private_v4(ip: &Ipv4Addr) -> bool {
    ip.is_private() && !ip.is_loopback() && !ip.is_link_local()
}

/// All /24 networks of the local private IPv4 interfaces.
fn local_subnets() -> Vec<[u8; 3]> {
    let mut nets: HashSet<[u8; 3]> = HashSet::new();
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in list {
            if let IpAddr::V4(v4) = ip {
                if is_private_v4(&v4) {
                    let o = v4.octets();
                    nets.insert([o[0], o[1], o[2]]);
                }
            }
        }
    }
    if nets.is_empty() {
        if let Ok(IpAddr::V4(v4)) = local_ip_address::local_ip() {
            let o = v4.octets();
            nets.insert([o[0], o[1], o[2]]);
        }
    }
    nets.into_iter().collect()
}

/// Discover WLED devices. Every newly found device is also emitted as a
/// `wled://found` event so the UI can show results while the scan runs.
#[tauri::command]
async fn discover(app: AppHandle, http: State<'_, Http>, scan_subnet: bool) -> Result<Vec<FoundDevice>, String> {
    let found: Arc<Mutex<Vec<FoundDevice>>> = Arc::new(Mutex::new(Vec::new()));

    let report = |dev: FoundDevice| {
        let found = found.clone();
        let app = app.clone();
        async move {
            let mut list = found.lock().await;
            if !list.iter().any(|d| d.ip == dev.ip || (!dev.mac.is_empty() && d.mac == dev.mac)) {
                let _ = app.emit(FOUND_EVENT, &dev);
                list.push(dev);
            }
        }
    };

    // 1) mDNS (runs on a blocking thread)
    let mdns_task = async {
        let ips = tauri::async_runtime::spawn_blocking(|| mdns_browse(Duration::from_millis(3500)))
            .await
            .unwrap_or_default();
        stream::iter(ips)
            .for_each_concurrent(16, |ip| {
                let report = &report;
                let client = &http.control;
                async move {
                    if let Some(dev) = probe(client, &ip, "mdns").await {
                        report(dev).await;
                    }
                }
            })
            .await;
    };

    // 2) /24 subnet sweep
    let scan_task = async {
        if !scan_subnet {
            return;
        }
        let hosts: Vec<String> = local_subnets()
            .into_iter()
            .flat_map(|n| (1u8..=254).map(move |h| format!("{}.{}.{}.{}", n[0], n[1], n[2], h)))
            .collect();
        stream::iter(hosts)
            .for_each_concurrent(96, |ip| {
                let report = &report;
                let client = &http.probe;
                async move {
                    if let Some(dev) = probe(client, &ip, "scan").await {
                        report(dev).await;
                    }
                }
            })
            .await;
    };

    futures::join!(mdns_task, scan_task);

    let list = found.lock().await.clone();
    Ok(list)
}

/// Check a single address (used for "add by IP").
#[tauri::command]
async fn probe_device(http: State<'_, Http>, ip: String) -> Result<FoundDevice, String> {
    valid_host(&ip)?;
    probe(&http.control, &ip, "manual")
        .await
        .ok_or_else(|| format!("No WLED device found at {ip}"))
}

/// GET http://{ip}{path} → JSON
#[tauri::command]
async fn wled_get(http: State<'_, Http>, ip: String, path: String) -> Result<Value, String> {
    valid_host(&ip)?;
    valid_path(&path)?;
    let resp = http
        .control
        .get(format!("http://{ip}{path}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

/// POST http://{ip}{path} with a JSON body → JSON
#[tauri::command]
async fn wled_post(http: State<'_, Http>, ip: String, path: String, body: Value) -> Result<Value, String> {
    valid_host(&ip)?;
    valid_path(&path)?;
    let resp = http
        .control
        .post(format!("http://{ip}{path}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Tray icon: left click opens the window, right click shows the menu.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Ambient PC Light")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let control = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(2500))
        .timeout(Duration::from_secs(6))
        .build()
        .expect("http client");
    let probe = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(700))
        .timeout(Duration::from_millis(1500))
        .build()
        .expect("probe client");

    tauri::Builder::default()
        // second launch (e.g. from the Start menu) just brings up the running instance
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![pc_power::AUTOSTART_ARG]),
        ))
        .manage(Http { control, probe })
        .manage(pc_power::PcPower::default())
        .setup(|app| {
            build_tray(app)?;
            if let Some(window) = app.get_webview_window("main") {
                pc_power::install_hooks(&window);
                // started with Windows → stay in the tray
                if !pc_power::launched_by_autostart() {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        // closing the window hides it to the tray; "Quit" in the tray menu quits
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            discover,
            probe_device,
            wled_get,
            wled_post,
            pc_power::set_pc_power
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
