import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SavedDevice } from "../types";
import type { Live } from "../useDeviceSockets";
import type { Settings, ThemeSetting } from "../useSettings";
import { DeviceInfoTwoRows, Switch } from "./DeviceListItem";
import { Icon } from "./Icon";

export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SwitchRow({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch-row" onClick={() => onChange(!checked)}>
      <div>
        <div>{label}</div>
        {sub && <div className="muted small">{sub}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

export function AddDeviceDialog({
  onClose,
  onAdd,
  onScan,
  scanning,
}: {
  onClose: () => void;
  onAdd: (ip: string, alias: string, hidden: boolean) => Promise<void>;
  onScan: () => void;
  scanning: boolean;
}) {
  const [ip, setIp] = useState("");
  const [alias, setAlias] = useState("");
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ip.trim()) return setError("Enter an address");
    setBusy(true);
    setError("");
    try {
      await onAdd(ip, alias, hidden);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add a device"
      onClose={onClose}
      actions={
        <>
          <button className="text-btn" onClick={onClose}>Cancel</button>
          <button className="filled-btn" onClick={() => submit()} disabled={busy}>
            {busy ? "Checking…" : "Add"}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="form">
        <Field label="IP address or hostname">
          <input autoFocus value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.50 or wled.local" />
        </Field>
        <Field label="Custom name (optional)">
          <input value={alias} onChange={(e) => setAlias(e.target.value)} />
        </Field>
        <SwitchRow label="Hide device" checked={hidden} onChange={setHidden} />
        {error && <div className="error">{error}</div>}
        <button type="submit" hidden />
      </form>
      <div className="divider" />
      <button className="tonal-btn block" onClick={onScan} disabled={scanning}>
        <Icon name="search" size={18} /> {scanning ? "Scanning the network…" : "Discover devices automatically"}
      </button>
    </Dialog>
  );
}

export function EditDeviceDialog({
  device,
  live,
  now,
  onClose,
  onSave,
  onDelete,
}: {
  device: SavedDevice;
  live?: Live;
  now: number;
  onClose: () => void;
  onSave: (p: Partial<SavedDevice>) => void;
  onDelete: () => void;
}) {
  const [alias, setAlias] = useState(device.alias ?? "");
  const [hidden, setHidden] = useState(!!device.hidden);
  const [onWithPc, setOnWithPc] = useState(!!device.onWithPc);
  const [offWithPc, setOffWithPc] = useState(!!device.offWithPc);
  const info = live?.info;

  return (
    <Dialog
      title="Edit device"
      onClose={onClose}
      actions={
        <>
          <button className="text-btn danger" onClick={onDelete}>
            <Icon name="delete" size={18} /> Delete
          </button>
          <span className="spacer" />
          <button className="text-btn" onClick={onClose}>Cancel</button>
          <button
            className="filled-btn"
            onClick={() => {
              onSave({ alias: alias.trim() || undefined, hidden, onWithPc, offWithPc });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <div className="device-preview">
          <DeviceInfoTwoRows device={{ ...device, alias, hidden }} live={live} now={now} />
        </div>
        <Field label="Custom name">
          <input autoFocus value={alias} placeholder={device.name} onChange={(e) => setAlias(e.target.value)} />
        </Field>
        <SwitchRow label="Hide device" sub="Hidden devices are not shown in the list" checked={hidden} onChange={setHidden} />
        <div className="settings-section">Sync with PC</div>
        <SwitchRow
          label="Turn on with PC"
          sub="When Windows starts or wakes up"
          checked={onWithPc}
          onChange={setOnWithPc}
        />
        <SwitchRow
          label="Turn off with PC"
          sub="On shutdown, restart and sleep"
          checked={offWithPc}
          onChange={setOffWithPc}
        />
        {(onWithPc || offWithPc) && (
          <div className="muted small">The app will start with Windows and run in the system tray.</div>
        )}
        <dl className="facts">
          <dt>Address</dt>
          <dd>{device.ip}</dd>
          <dt>MAC</dt>
          <dd>{device.mac || "—"}</dd>
          {info && (
            <>
              <dt>WLED version</dt>
              <dd>{info.ver}</dd>
              <dt>LEDs</dt>
              <dd>{info.leds.count}</dd>
              {info.wifi?.signal !== undefined && (
                <>
                  <dt>Wi-Fi</dt>
                  <dd>{info.wifi.signal}%</dd>
                </>
              )}
            </>
          )}
        </dl>
      </div>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({
  device,
  live,
  now,
  onClose,
  onConfirm,
}: {
  device: SavedDevice;
  live?: Live;
  now: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      title="Delete device?"
      onClose={onClose}
      actions={
        <>
          <button className="text-btn" onClick={onClose}>Cancel</button>
          <button className="text-btn danger" onClick={onConfirm}>Delete</button>
        </>
      }
    >
      <div className="device-preview">
        <DeviceInfoTwoRows device={device} live={live} now={now} />
      </div>
    </Dialog>
  );
}

const THEMES: [ThemeSetting, string][] = [
  ["auto", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

export function SettingsDialog({ settings, update, onClose }: { settings: Settings; update: (p: Partial<Settings>) => void; onClose: () => void }) {
  return (
    <Dialog title="Settings" onClose={onClose} actions={<button className="text-btn" onClick={onClose}>Done</button>}>
      <div className="form">
        <div className="field">
          <span>Theme</span>
          <div className="segmented">
            {THEMES.map(([v, label]) => (
              <button key={v} className={settings.theme === v ? "active" : ""} onClick={() => update({ theme: v })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <SwitchRow
          label="Show offline devices last"
          checked={settings.showOfflineLast}
          onChange={(v) => update({ showOfflineLast: v })}
        />
        <SwitchRow
          label="Discover devices on startup"
          sub="Uses mDNS"
          checked={settings.autoDiscover}
          onChange={(v) => update({ autoDiscover: v })}
        />
        <SwitchRow label="Show hidden devices" checked={settings.showHidden} onChange={(v) => update({ showHidden: v })} />
      </div>
    </Dialog>
  );
}

export function Drawer({
  open,
  onClose,
  showHidden,
  onAdd,
  onToggleHidden,
  onScan,
  onSettings,
  scanning,
}: {
  open: boolean;
  onClose: () => void;
  showHidden: boolean;
  onAdd: () => void;
  onToggleHidden: () => void;
  onScan: () => void;
  onSettings: () => void;
  scanning: boolean;
}) {
  const item = (icon: Parameters<typeof Icon>[0]["name"], label: string, action: () => void, disabled = false) => (
    <button
      className="drawer-item"
      disabled={disabled}
      onClick={() => {
        onClose();
        action();
      }}
    >
      <Icon name={icon} /> {label}
    </button>
  );
  return (
    <div className={`drawer-scrim ${open ? "open" : ""}`} onClick={onClose}>
      <nav className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <img src="/icon.png" alt="" />
          <span>Ambient PC Light</span>
        </div>
        {item("add", "Add a device", onAdd)}
        {item("search", scanning ? "Scanning…" : "Scan network", onScan, scanning)}
        {item(showHidden ? "visibilityOff" : "visibility", showHidden ? "Hide hidden devices" : "Show hidden devices", onToggleHidden)}
        {item("settings", "Settings", onSettings)}
        <div className="divider" />
        {item("help", "WLED help", () => openUrl("https://kno.wled.ge/"))}
        <div className="drawer-version">v0.1.0</div>
      </nav>
    </div>
  );
}
