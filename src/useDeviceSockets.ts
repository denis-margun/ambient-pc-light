import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { applyPatch, type StatePatch } from "./useWled";
import type { WledInfo, WledState } from "./types";

export type WsStatus = "connecting" | "connected" | "disconnected";

export interface Live {
  status: WsStatus;
  state?: WledState;
  info?: WledInfo;
}

const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30000;
const CONNECT_TIMEOUT_MS = 5000;
const PING_MS = 15000;
/** No message for this long → connection is considered dead. */
const STALE_MS = 40000;

interface Conn {
  ws?: WebSocket;
  retry: number;
  timer?: number;
  lastMsg: number;
  closed: boolean;
}

/**
 * Keeps one WebSocket per device (`ws://ip/ws`), like WLED Native does.
 * WLED pushes the full {state, info} on connect and after every change.
 */
export function useDeviceSockets(ips: string[], onSeen: (ip: string, info?: WledInfo) => void) {
  const [live, setLive] = useState<Record<string, Live>>({});
  const conns = useRef(new Map<string, Conn>());
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  const patch = useCallback((ip: string, p: Partial<Live>) => {
    setLive((l) => ({ ...l, [ip]: { ...(l[ip] ?? { status: "connecting" }), ...p } }));
  }, []);

  const open = useCallback(
    (ip: string, c: Conn) => {
      if (c.closed) return;
      patch(ip, { status: "connecting" });
      const retryLater = () => {
        if (c.closed) return;
        c.timer = window.setTimeout(() => open(ip, c), c.retry);
        c.retry = Math.min(c.retry * 2, RETRY_MAX_MS);
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(`ws://${ip}/ws`);
      } catch {
        patch(ip, { status: "disconnected" });
        retryLater();
        return;
      }
      c.ws = ws;
      const connectTimer = window.setTimeout(() => ws.readyState !== WebSocket.OPEN && ws.close(), CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        window.clearTimeout(connectTimer);
        c.retry = RETRY_MIN_MS;
        c.lastMsg = Date.now();
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        let msg: { state?: WledState; info?: WledInfo };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        c.lastMsg = Date.now();
        const p: Partial<Live> = { status: "connected" };
        if (msg.state && Array.isArray(msg.state.seg)) p.state = msg.state;
        if (msg.info) p.info = msg.info;
        patch(ip, p);
        onSeenRef.current(ip, msg.info);
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        window.clearTimeout(connectTimer);
        if (c.ws !== ws) return;
        c.ws = undefined;
        patch(ip, { status: "disconnected" });
        retryLater();
      };
    },
    [patch],
  );

  const reconnect = useCallback(
    (ip: string) => {
      const c = conns.current.get(ip);
      if (!c || c.ws?.readyState === WebSocket.OPEN) return;
      window.clearTimeout(c.timer);
      const old = c.ws;
      c.ws = undefined;
      old?.close();
      c.retry = RETRY_MIN_MS;
      open(ip, c);
    },
    [open],
  );

  // open / close sockets as the device list changes
  const key = [...new Set(ips)].sort().join(",");
  useEffect(() => {
    const wanted = new Set(key ? key.split(",") : []);
    for (const [ip, c] of conns.current) {
      if (wanted.has(ip)) continue;
      c.closed = true;
      window.clearTimeout(c.timer);
      c.ws?.close();
      conns.current.delete(ip);
    }
    for (const ip of wanted) {
      if (conns.current.has(ip)) continue;
      const c: Conn = { retry: RETRY_MIN_MS, lastMsg: 0, closed: false };
      conns.current.set(ip, c);
      open(ip, c);
    }
  }, [key, open]);

  // close everything on unmount
  useEffect(() => {
    const map = conns.current;
    return () => {
      for (const c of map.values()) {
        c.closed = true;
        window.clearTimeout(c.timer);
        c.ws?.close();
      }
      map.clear();
    };
  }, []);

  // keepalive: WLED only pushes on change, so ask for state periodically
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      for (const c of conns.current.values()) {
        if (c.ws?.readyState !== WebSocket.OPEN) continue;
        if (now - c.lastMsg > STALE_MS) c.ws.close();
        else c.ws.send('{"v":true}');
      }
    }, PING_MS);
    return () => window.clearInterval(id);
  }, []);

  /** Send a state patch (optimistic). Falls back to HTTP when the socket is down. */
  const send = useCallback((ip: string, p: StatePatch) => {
    setLive((l) => {
      const cur = l[ip];
      return cur?.state ? { ...l, [ip]: { ...cur, state: applyPatch(cur.state, p) } } : l;
    });
    const ws = conns.current.get(ip)?.ws;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(p));
    else api.setState(ip, p).catch(() => undefined);
  }, []);

  return { live, send, reconnect };
}
