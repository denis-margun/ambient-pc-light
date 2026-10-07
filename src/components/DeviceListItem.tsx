import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import type { SavedDevice, WledState } from "../types";
import type { Live, WsStatus } from "../useDeviceSockets";
import { Icon } from "./Icon";

/** After losing the connection, keep showing a device as online for this long. */
export const OFFLINE_GRACE_MS = 60000;

export function deviceName(d: SavedDevice) {
  return d.alias?.trim() || d.name || d.ip;
}

export function isShownOffline(d: SavedDevice, live: Live | undefined, now: number) {
  return live?.status !== "connected" && now - (d.lastSeen ?? 0) >= OFFLINE_GRACE_MS;
}

/** Device colour = primary colour of the first selected segment (WLED Native does the same). */
export function deviceColor(state?: WledState): string | undefined {
  const seg = state?.seg?.find((s) => s.sel) ?? state?.seg?.[0];
  const c = seg?.col?.[0];
  if (!c) return undefined;
  let [r, g, b] = c;
  const w = c[3] ?? 0;
  if (r + g + b === 0 && w === 0) return undefined;
  if (r + g + b === 0) [r, g, b] = [255, 224, 180]; // white channel only
  return `rgb(${r}, ${g}, ${b})`;
}

function timeAgo(ts: number | undefined, now: number) {
  if (!ts) return "a while ago";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const STATUS_TEXT: Record<WsStatus, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  disconnected: "Disconnected",
};

/** Circle = connected, spinning star = connecting, diamond = disconnected. */
export function StatusShape({ status }: { status: WsStatus }) {
  return (
    <span className={`status-shape ${status}`} title={STATUS_TEXT[status]}>
      <svg viewBox="0 0 20 20" width="12" height="12">
        {status === "connected" && <circle cx="10" cy="10" r="8" />}
        {status === "connecting" && (
          <polygon points="10,1 12.3,4.5 16.4,3.6 15.5,7.7 19,10 15.5,12.3 16.4,16.4 12.3,15.5 10,19 7.7,15.5 3.6,16.4 4.5,12.3 1,10 4.5,7.7 3.6,3.6 7.7,4.5" />
        )}
        {status === "disconnected" && <rect x="4" y="4" width="12" height="12" rx="3" transform="rotate(45 10 10)" />}
      </svg>
    </span>
  );
}

export function DeviceInfoTwoRows({
  device,
  live,
  now,
  oneLine,
}: {
  device: SavedDevice;
  live?: Live;
  now: number;
  oneLine?: boolean;
}) {
  const status = live?.status ?? "connecting";
  return (
    <div className="info2">
      <div className={`info2-name ${oneLine ? "one" : ""}`}>{deviceName(device)}</div>
      <div className="info2-sub">
        <StatusShape status={status} />
        <span className="info2-addr">{device.ip}</span>
        {status !== "connected" && <span className="info2-offline">· offline, seen {timeAgo(device.lastSeen, now)}</span>}
        {device.hidden && (
          <span className="info2-hidden">
            <Icon name="visibilityOff" size={14} /> hidden
          </span>
        )}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`m3-switch ${checked ? "on" : ""}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="thumb" />
    </button>
  );
}

/** Brightness slider that only sends when released, with a value bubble while dragging. */
function BrightnessSlider({ value, onCommit, disabled }: { value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [pos, setPos] = useState(value);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag) setPos(value);
  }, [value, drag]);

  const commit = () => {
    if (!drag) return;
    setDrag(false);
    if (pos !== value) onCommit(pos);
  };
  const pct = ((pos - 1) / 254) * 100;

  return (
    <div className="bri" onClick={(e) => e.stopPropagation()} style={{ "--pct": `${pct}%` } as CSSProperties}>
      <input
        type="range"
        min={1}
        max={255}
        value={pos}
        disabled={disabled}
        aria-label="Brightness"
        onPointerDown={() => setDrag(true)}
        onChange={(e) => {
          setDrag(true);
          setPos(Number(e.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {drag && <span className="bri-label">{Math.round((pos / 255) * 100)}%</span>}
    </div>
  );
}

export function DeviceListItem({
  device,
  live,
  now,
  selected,
  offline,
  onClick,
  onEdit,
  onContextMenu,
  onPower,
  onBrightness,
}: {
  device: SavedDevice;
  live?: Live;
  now: number;
  selected: boolean;
  offline: boolean;
  onClick: () => void;
  onEdit: () => void;
  onContextMenu: (e: MouseEvent) => void;
  onPower: (on: boolean) => void;
  onBrightness: (bri: number) => void;
}) {
  const color = offline ? undefined : deviceColor(live?.state);
  const connected = live?.status === "connected";
  return (
    <div
      className={`dcard ${selected ? "selected" : ""} ${offline ? "offline" : ""} ${color ? "tinted" : ""}`}
      style={color ? ({ "--dc": color } as CSSProperties) : undefined}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      onContextMenu={onContextMenu}
    >
      <div className="dcard-top">
        <DeviceInfoTwoRows device={device} live={live} now={now} />
        <button
          className="dcard-edit"
          title="Edit"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Icon name="edit" size={18} />
        </button>
        <Switch checked={!!live?.state?.on} onChange={onPower} disabled={!connected} />
      </div>
      <BrightnessSlider value={live?.state?.bri ?? 0} onCommit={onBrightness} disabled={!connected} />
    </div>
  );
}

export function SkeletonDeviceRow() {
  return (
    <div className="dcard skeleton">
      <div className="dcard-top">
        <div className="info2">
          <div className="shimmer" style={{ width: "60%", height: 16 }} />
          <div className="shimmer" style={{ width: "40%", height: 12, marginTop: 8 }} />
        </div>
        <div className="shimmer" style={{ width: 50, height: 30, borderRadius: 16 }} />
      </div>
      <div className="shimmer" style={{ height: 24, borderRadius: 12, marginTop: 12 }} />
    </div>
  );
}
