export type RGB = [number, number, number] | [number, number, number, number];

export interface WledSegment {
  id: number;
  start: number;
  stop: number;
  on?: boolean;
  bri?: number;
  col: RGB[];
  fx: number;
  sx: number;
  ix: number;
  pal: number;
  sel?: boolean;
  n?: string;
}

export interface WledNightlight {
  on: boolean;
  dur: number;
  mode: number;
  tbri: number;
}

export interface WledState {
  on: boolean;
  bri: number;
  transition?: number;
  ps: number;
  pl?: number;
  nl?: WledNightlight;
  seg: WledSegment[];
}

export interface WledInfo {
  ver: string;
  name: string;
  mac: string;
  ip?: string;
  arch?: string;
  brand?: string;
  product?: string;
  uptime?: number;
  fxcount?: number;
  palcount?: number;
  leds: { count: number; rgbw?: boolean; pwr?: number; maxpwr?: number; fps?: number };
  wifi?: { signal?: number; rssi?: number; channel?: number };
}

/** Result of discovery / probing returned by the Rust side. */
export interface FoundDevice {
  ip: string;
  name: string;
  mac: string;
  version: string;
  ledCount: number;
  source: "mdns" | "scan" | "manual";
}

/** What we persist locally about a device. */
export interface SavedDevice {
  ip: string;
  name: string;
  mac: string;
  alias?: string;
  hidden?: boolean;
  /** Turn on when Windows starts / wakes up. */
  onWithPc?: boolean;
  /** Turn off when Windows shuts down / goes to sleep. */
  offWithPc?: boolean;
  /** Last time the device answered (ms since epoch). */
  lastSeen?: number;
}

export interface Preset {
  id: number;
  name: string;
}

export interface DeviceRuntime {
  online: boolean;
  loading: boolean;
  error?: string;
  state?: WledState;
  info?: WledInfo;
  effects?: string[];
  palettes?: string[];
  presets?: Preset[];
  lastSeen?: number;
}
