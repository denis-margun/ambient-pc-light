import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FoundDevice, Preset, WledInfo, WledState } from "./types";

export function discover(scanSubnet: boolean): Promise<FoundDevice[]> {
  return invoke("discover", { scanSubnet });
}

export function onDeviceFound(cb: (d: FoundDevice) => void): Promise<UnlistenFn> {
  return listen<FoundDevice>("wled://found", (e) => cb(e.payload));
}

/** Which devices follow the PC: on with Windows start/wake, off with shutdown/sleep. Also toggles autostart. */
export function setPcPower(config: { onIps: string[]; offIps: string[] }): Promise<void> {
  return invoke("set_pc_power", { config });
}

export function probeDevice(ip: string): Promise<FoundDevice> {
  return invoke("probe_device", { ip });
}

function get<T>(ip: string, path: string): Promise<T> {
  return invoke<T>("wled_get", { ip, path });
}

function post<T>(ip: string, path: string, body: unknown): Promise<T> {
  return invoke<T>("wled_post", { ip, path, body });
}

/** Full snapshot: state + info + effects + palettes. */
export function getFull(ip: string) {
  return get<{ state: WledState; info: WledInfo; effects: string[]; palettes: string[] }>(ip, "/json");
}

/** Lightweight poll: state + info. */
export function getStateInfo(ip: string) {
  return get<{ state: WledState; info: WledInfo }>(ip, "/json/si");
}

/** Send a partial state; returns the complete new state ("v": true). */
export function setState(ip: string, patch: Record<string, unknown>) {
  return post<WledState>(ip, "/json/state", { ...patch, v: true });
}

export async function getPresets(ip: string): Promise<Preset[]> {
  const raw = await get<Record<string, { n?: string }>>(ip, "/presets.json");
  return Object.entries(raw)
    .filter(([id, p]) => id !== "0" && p && Object.keys(p).length > 0)
    .map(([id, p]) => ({ id: Number(id), name: p.n || `Preset ${id}` }))
    .sort((a, b) => a.id - b.id);
}
