import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { FoundDevice, SavedDevice, WledInfo } from "./types";

const STORAGE_KEY = "ambient-pc-light.devices";
/** Don't rewrite storage on every websocket message. */
const SEEN_RESOLUTION_MS = 15000;

function loadSaved(): SavedDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedDevice[]) : [];
  } catch {
    return [];
  }
}

/** Persistent device list (names, hidden flag, last seen). */
export function useDevices() {
  const [saved, setSaved] = useState<SavedDevice[]>(loadSaved);
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved]);

  /** Add (or update) a device. Matches by MAC so IP changes are followed. */
  const addDevice = useCallback((d: FoundDevice, extra?: Partial<SavedDevice>) => {
    const now = Date.now();
    setSaved((list) => {
      const idx = list.findIndex((x) => x.ip === d.ip || (d.mac && x.mac === d.mac));
      if (idx >= 0) {
        const copy = [...list];
        const old = list[idx];
        copy[idx] = { ...old, ip: d.ip, name: d.name, mac: d.mac || old.mac, lastSeen: now, ...extra };
        return copy;
      }
      return [...list, { ip: d.ip, name: d.name, mac: d.mac, lastSeen: now, ...extra }];
    });
  }, []);

  const scan = useCallback(
    async (subnet: boolean) => {
      if (scanningRef.current) return 0;
      scanningRef.current = true;
      setScanning(true);
      const unlisten = await api.onDeviceFound((d) => addDevice(d));
      try {
        const list = await api.discover(subnet);
        list.forEach((d) => addDevice(d));
        return list.length;
      } finally {
        unlisten();
        scanningRef.current = false;
        setScanning(false);
      }
    },
    [addDevice],
  );

  const addByIp = useCallback(
    async (ip: string, extra?: Partial<SavedDevice>) => {
      const dev = await api.probeDevice(ip.trim());
      addDevice(dev, extra);
      return dev;
    },
    [addDevice],
  );

  /** Called for every websocket message: keeps lastSeen and the device name fresh. */
  const markSeen = useCallback((ip: string, info?: WledInfo) => {
    const now = Date.now();
    setSaved((list) => {
      const i = list.findIndex((d) => d.ip === ip);
      if (i < 0) return list;
      const d = list[i];
      const name = info?.name || d.name;
      if (name === d.name && now - (d.lastSeen ?? 0) < SEEN_RESOLUTION_MS) return list;
      const copy = [...list];
      copy[i] = { ...d, name, lastSeen: now };
      return copy;
    });
  }, []);

  const updateDevice = useCallback((ip: string, p: Partial<SavedDevice>) => {
    setSaved((l) => l.map((d) => (d.ip === ip ? { ...d, ...p } : d)));
  }, []);

  const removeDevice = useCallback((ip: string) => {
    setSaved((l) => l.filter((d) => d.ip !== ip));
  }, []);

  return { saved, scanning, scan, addByIp, markSeen, updateDevice, removeDevice };
}
