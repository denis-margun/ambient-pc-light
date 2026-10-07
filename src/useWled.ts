import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { DeviceRuntime, FoundDevice, SavedDevice, WledState } from "./types";

const STORAGE_KEY = "ambient-pc-light.devices";
const POLL_MS = 3000;
/** After a local change, ignore polled state for this long (avoids slider "jumping back"). */
const LOCAL_HOLD_MS = 1500;

export type StatePatch = Record<string, unknown>;

function loadSaved(): SavedDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedDevice[]) : [];
  } catch {
    return [];
  }
}

function mergePatch(a: StatePatch, b: StatePatch): StatePatch {
  const out: StatePatch = { ...a, ...b };
  const sa = a.seg as StatePatch | undefined;
  const sb = b.seg as StatePatch | undefined;
  if (sa && sb && !Array.isArray(sa) && !Array.isArray(sb)) {
    const seg: StatePatch = { ...sa, ...sb };
    if (Array.isArray(sa.col) && Array.isArray(sb.col)) {
      seg.col = [0, 1, 2].map((i) => {
        const n = (sb.col as number[][])[i];
        return n && n.length ? n : ((sa.col as number[][])[i] ?? []);
      });
    }
    out.seg = seg;
  }
  // switching preset or effect makes earlier unrelated parts irrelevant – fine to keep merged
  return out;
}

/** Apply a WLED JSON patch to a local state copy for optimistic UI. */
export function applyPatch(state: WledState, patch: StatePatch): WledState {
  const next: WledState = { ...state, seg: state.seg.map((s) => ({ ...s })) };
  if (typeof patch.on === "boolean") next.on = patch.on;
  if (patch.on === "t") next.on = !state.on;
  if (typeof patch.bri === "number") {
    next.bri = patch.bri;
    if (patch.bri > 0 && patch.on === undefined) next.on = true;
  }
  if (typeof patch.ps === "number") next.ps = patch.ps;
  if (patch.nl && next.nl) next.nl = { ...next.nl, ...(patch.nl as object) };
  const seg = patch.seg as StatePatch | undefined;
  if (seg && !Array.isArray(seg)) {
    next.seg = next.seg.map((s) => {
      if (s.sel === false) return s;
      const merged = { ...s, ...(seg as object) };
      if (Array.isArray(seg.col)) {
        // empty slot ([]) means "keep this color"
        merged.col = s.col.map((c, i) => {
          const n = (seg.col as number[][])[i];
          return n && n.length ? (n as typeof c) : c;
        });
      }
      return merged;
    });
  }
  return next;
}

export function useWled() {
  const [saved, setSaved] = useState<SavedDevice[]>(loadSaved);
  const [runtime, setRuntime] = useState<Record<string, DeviceRuntime>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);

  const savedRef = useRef(saved);
  savedRef.current = saved;
  const holdUntil = useRef<Record<string, number>>({});
  const inFlight = useRef<Record<string, boolean>>({});
  const queued = useRef<Record<string, StatePatch | undefined>>({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved]);

  const patchRuntime = useCallback((ip: string, p: Partial<DeviceRuntime>) => {
    setRuntime((r) => {
      const prev: DeviceRuntime = r[ip] ?? { online: false, loading: false };
      return { ...r, [ip]: { ...prev, ...p } };
    });
  }, []);

  /** Load full device data (effects, palettes, presets). */
  const loadFull = useCallback(
    async (ip: string) => {
      patchRuntime(ip, { loading: true });
      try {
        const full = await api.getFull(ip);
        patchRuntime(ip, {
          online: true,
          loading: false,
          error: undefined,
          state: full.state,
          info: full.info,
          effects: full.effects,
          palettes: full.palettes,
          lastSeen: Date.now(),
        });
        api
          .getPresets(ip)
          .then((presets) => patchRuntime(ip, { presets }))
          .catch(() => patchRuntime(ip, { presets: [] }));
      } catch (e) {
        patchRuntime(ip, { online: false, loading: false, error: String(e) });
      }
    },
    [patchRuntime],
  );

  // initial load for every saved device
  const loadedOnce = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const d of saved) {
      if (!loadedOnce.current.has(d.ip)) {
        loadedOnce.current.add(d.ip);
        void loadFull(d.ip);
      }
    }
  }, [saved, loadFull]);

  // polling
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  useEffect(() => {
    const tick = () => {
      for (const d of savedRef.current) {
        const rt = runtimeRef.current[d.ip];
        if (rt?.loading) continue;
        // device came back online but we never got effects → reload fully
        if (!rt?.effects) {
          if (!rt?.loading) void loadFull(d.ip);
          continue;
        }
        api
          .getStateInfo(d.ip)
          .then(({ state, info }) => {
            const hold = (holdUntil.current[d.ip] ?? 0) > Date.now() || inFlight.current[d.ip];
            patchRuntime(d.ip, {
              online: true,
              error: undefined,
              info,
              lastSeen: Date.now(),
              ...(hold ? {} : { state }),
            });
          })
          .catch((e) => patchRuntime(d.ip, { online: false, error: String(e) }));
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [loadFull, patchRuntime]);

  /** Send queued patch for one device, coalescing rapid updates (sliders). */
  const flush = useCallback(
    async (ip: string) => {
      if (inFlight.current[ip]) return;
      const patch = queued.current[ip];
      if (!patch) return;
      queued.current[ip] = undefined;
      inFlight.current[ip] = true;
      try {
        const state = await api.setState(ip, patch);
        holdUntil.current[ip] = Date.now() + LOCAL_HOLD_MS;
        // only accept server state if nothing newer is waiting
        if (!queued.current[ip] && state && Array.isArray(state.seg)) {
          patchRuntime(ip, { state, online: true, error: undefined });
        }
      } catch (e) {
        patchRuntime(ip, { online: false, error: String(e) });
      } finally {
        inFlight.current[ip] = false;
        if (queued.current[ip]) void flush(ip);
      }
    },
    [patchRuntime],
  );

  /** Apply a state patch to one or many devices (optimistic). */
  const send = useCallback(
    (ips: string[], patch: StatePatch) => {
      const now = Date.now();
      setRuntime((r) => {
        const next = { ...r };
        for (const ip of ips) {
          const rt = next[ip];
          if (rt?.state) next[ip] = { ...rt, state: applyPatch(rt.state, patch) };
        }
        return next;
      });
      for (const ip of ips) {
        holdUntil.current[ip] = now + LOCAL_HOLD_MS;
        queued.current[ip] = queued.current[ip] ? mergePatch(queued.current[ip]!, patch) : patch;
        void flush(ip);
      }
    },
    [flush],
  );

  /** Add (or update) a discovered device. Matches by MAC so IP changes are followed. */
  const addDevice = useCallback((d: FoundDevice) => {
    setSaved((list) => {
      const idx = list.findIndex((x) => x.ip === d.ip || (d.mac && x.mac === d.mac));
      if (idx >= 0) {
        const old = list[idx];
        if (old.ip === d.ip && old.name === d.name) return list;
        const copy = [...list];
        copy[idx] = { ...old, ip: d.ip, name: d.name, mac: d.mac || old.mac };
        return copy;
      }
      return [...list, { ip: d.ip, name: d.name, mac: d.mac }];
    });
  }, []);

  const scan = useCallback(
    async (subnet: boolean) => {
      setScanning(true);
      const unlisten = await api.onDeviceFound(addDevice);
      try {
        const list = await api.discover(subnet);
        list.forEach(addDevice);
        return list.length;
      } finally {
        unlisten();
        setScanning(false);
      }
    },
    [addDevice],
  );

  const addByIp = useCallback(
    async (ip: string) => {
      const dev = await api.probeDevice(ip.trim());
      addDevice(dev);
      return dev;
    },
    [addDevice],
  );

  const removeDevice = useCallback((ip: string) => {
    setSaved((l) => l.filter((d) => d.ip !== ip));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(ip);
      return n;
    });
    loadedOnce.current.delete(ip);
  }, []);

  const renameDevice = useCallback((ip: string, alias: string) => {
    setSaved((l) => l.map((d) => (d.ip === ip ? { ...d, alias: alias.trim() || undefined } : d)));
  }, []);

  const moveDevice = useCallback((ip: string, dir: -1 | 1) => {
    setSaved((l) => {
      const i = l.findIndex((d) => d.ip === ip);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const c = [...l];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  }, []);

  const toggleSelect = useCallback((ip: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(ip)) n.delete(ip);
      else n.add(ip);
      return n;
    });
  }, []);

  const selectAll = useCallback((ips: string[]) => setSelected(new Set(ips)), []);

  return {
    saved,
    runtime,
    selected,
    scanning,
    scan,
    addByIp,
    removeDevice,
    renameDevice,
    moveDevice,
    toggleSelect,
    selectAll,
    send,
    reload: loadFull,
  };
}
