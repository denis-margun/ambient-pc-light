import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "./api";
import { AddDeviceDialog, ConfirmDeleteDialog, Drawer, EditDeviceDialog, SettingsDialog } from "./components/Dialogs";
import {
  DeviceInfoTwoRows,
  DeviceListItem,
  SkeletonDeviceRow,
  deviceColor,
  deviceName,
  isShownOffline,
} from "./components/DeviceListItem";
import { Icon, IconButton } from "./components/Icon";
import { useDevices } from "./useDevices";
import { useDeviceSockets } from "./useDeviceSockets";
import { useSettings } from "./useSettings";
import type { SavedDevice } from "./types";

const SELECTED_KEY = "ambient-pc-light.selected";
const TWO_PANE_MIN_WIDTH = 820;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useWide() {
  const q = `(min-width: ${TWO_PANE_MIN_WIDTH}px)`;
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return wide;
}

type DialogState =
  | { kind: "add" }
  | { kind: "edit"; ip: string }
  | { kind: "delete"; ip: string }
  | { kind: "settings" }
  | null;

export default function App() {
  const devices = useDevices();
  const { settings, update: updateSettings } = useSettings();
  const sockets = useDeviceSockets(
    devices.saved.map((d) => d.ip),
    devices.markSeen,
  );
  const now = useNow(5000);
  const wide = useWide();

  const [selectedIp, setSelectedIp] = useState<string | null>(() => localStorage.getItem(SELECTED_KEY));
  const [showDetail, setShowDetail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [menu, setMenu] = useState<{ ip: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [frameLoading, setFrameLoading] = useState(false);

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 3500);
  };

  // remember selection
  useEffect(() => {
    if (selectedIp) localStorage.setItem(SELECTED_KEY, selectedIp);
    else localStorage.removeItem(SELECTED_KEY);
  }, [selectedIp]);

  const selected = devices.saved.find((d) => d.ip === selectedIp);
  useEffect(() => {
    if (selectedIp && !selected) setSelectedIp(null);
  }, [selectedIp, selected]);

  // keep the Rust side in sync for power-on/off with the PC
  const onIps = devices.saved.filter((d) => d.onWithPc).map((d) => d.ip).join(",");
  const offIps = devices.saved.filter((d) => d.offWithPc).map((d) => d.ip).join(",");
  useEffect(() => {
    const split = (s: string) => (s ? s.split(",") : []);
    api.setPcPower({ onIps: split(onIps), offIps: split(offIps) }).catch((e) => notify(`Autostart: ${e}`));
  }, [onIps, offIps]);

  // auto discovery on start
  const { scan } = devices;
  useEffect(() => {
    if (settings.autoDiscover) void scan(false).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(
    async (subnet: boolean) => {
      devices.saved.forEach((d) => sockets.reconnect(d.ip));
      try {
        const n = await scan(subnet);
        if (subnet) notify(n ? `Found ${n} device${n === 1 ? "" : "s"}` : "No WLED devices found");
      } catch (e) {
        notify(String(e));
      }
    },
    [devices.saved, sockets, scan],
  );

  // sorted + filtered like WLED Native
  const visible = useMemo(
    () =>
      devices.saved
        .filter((d) => !d.hidden || settings.showHidden)
        .sort((a, b) => deviceName(a).localeCompare(deviceName(b), undefined, { sensitivity: "base" })),
    [devices.saved, settings.showHidden],
  );
  const online = visible.filter((d) => !isShownOffline(d, sockets.live[d.ip], now));
  const offline = visible.filter((d) => isShownOffline(d, sockets.live[d.ip], now));

  const select = (d: SavedDevice) => {
    if (d.ip === selectedIp) setFrameKey((k) => k + 1);
    setSelectedIp(d.ip);
    setShowDetail(true);
    setFrameLoading(true);
  };

  const renderItem = (d: SavedDevice) => (
    <DeviceListItem
      key={d.mac || d.ip}
      device={d}
      live={sockets.live[d.ip]}
      now={now}
      selected={wide && d.ip === selectedIp}
      offline={isShownOffline(d, sockets.live[d.ip], now)}
      onClick={() => select(d)}
      onEdit={() => setDialog({ kind: "edit", ip: d.ip })}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ ip: d.ip, x: e.clientX, y: e.clientY });
      }}
      onPower={(on) => sockets.send(d.ip, { on })}
      onBrightness={(bri) => sockets.send(d.ip, { bri })}
    />
  );

  const list = (
    <section className="pane list-pane">
      <header className="appbar">
        <IconButton icon="menu" title="Menu" onClick={() => setDrawer(true)} />
        <div className="appbar-logo">
          <img src="/icon.png" alt="" />
          <span>WLED</span>
        </div>
        <IconButton icon="refresh" title="Refresh" onClick={() => refresh(false)} spin={devices.scanning} />
        <IconButton icon="add" title="Add device" onClick={() => setDialog({ kind: "add" })} />
      </header>
      <div className="list-scroll">
        {visible.length === 0 ? (
          devices.scanning ? (
            [0, 1, 2].map((i) => <SkeletonDeviceRow key={i} />)
          ) : (
            <div className="no-devices">
              <div className="no-devices-icon">
                <Icon name="bulb" size={56} />
              </div>
              <h2>No devices found</h2>
              <p className="muted">Make sure your WLED is on the same network, or add it manually.</p>
              <button className="filled-btn" onClick={() => setDialog({ kind: "add" })}>
                <Icon name="add" size={18} /> Add device
              </button>
              <button className="tonal-btn" onClick={() => refresh(true)}>
                <Icon name="search" size={18} /> Scan network
              </button>
              {devices.saved.length > 0 && (
                <button className="text-btn" onClick={() => updateSettings({ showHidden: true })}>
                  Show hidden devices
                </button>
              )}
            </div>
          )
        ) : settings.showOfflineLast ? (
          <>
            {online.map(renderItem)}
            {offline.length > 0 && <div className="list-label">Offline devices</div>}
            {offline.map(renderItem)}
          </>
        ) : (
          visible.map(renderItem)
        )}
      </div>
    </section>
  );

  const selColor = selected ? deviceColor(sockets.live[selected.ip]?.state) : undefined;
  const detail = selected ? (
    <section className="pane detail-pane" style={selColor ? ({ "--dc": selColor } as CSSProperties) : undefined}>
      <header className="appbar detail-bar">
        {!wide && <IconButton icon="back" title="Back" onClick={() => setShowDetail(false)} />}
        <div className="detail-title">
          <DeviceInfoTwoRows device={selected} live={sockets.live[selected.ip]} now={now} oneLine />
        </div>
        {frameLoading && <span className="progress" />}
        <IconButton icon="refresh" title="Reload page" onClick={() => { setFrameLoading(true); setFrameKey((k) => k + 1); }} />
        <IconButton icon="openInNew" title="Open in browser" onClick={() => openUrl(`http://${selected.ip}`)} />
        <IconButton icon="edit" title="Edit device" onClick={() => setDialog({ kind: "edit", ip: selected.ip })} />
      </header>
      <div className="frame-wrap">
        <iframe
          key={`${selected.ip}#${frameKey}`}
          className="wled-frame"
          src={`http://${selected.ip}/`}
          title={deviceName(selected)}
          onLoad={() => setFrameLoading(false)}
        />
      </div>
    </section>
  ) : (
    <section className="pane detail-pane empty-detail">
      <Icon name="bulb" size={64} />
      <p className="muted">Select a device from the list</p>
    </section>
  );

  const dlgDevice = dialog && "ip" in dialog ? devices.saved.find((d) => d.ip === dialog.ip) : undefined;

  return (
    <div className={`shell ${wide ? "wide" : "narrow"}`} onClick={() => menu && setMenu(null)}>
      {wide ? (
        <>
          {list}
          {detail}
        </>
      ) : showDetail && selected ? (
        detail
      ) : (
        list
      )}

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        showHidden={settings.showHidden}
        scanning={devices.scanning}
        onAdd={() => setDialog({ kind: "add" })}
        onScan={() => refresh(true)}
        onToggleHidden={() => updateSettings({ showHidden: !settings.showHidden })}
        onSettings={() => setDialog({ kind: "settings" })}
      />

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {(
            [
              ["edit", "Edit", () => setDialog({ kind: "edit", ip: menu.ip })],
              ["openInNew", "Open in browser", () => openUrl(`http://${menu.ip}`)],
              ["delete", "Delete", () => setDialog({ kind: "delete", ip: menu.ip })],
            ] as const
          ).map(([icon, label, fn]) => (
            <button
              key={label}
              className={icon === "delete" ? "danger" : ""}
              onClick={() => {
                setMenu(null);
                fn();
              }}
            >
              <Icon name={icon} size={18} /> {label}
            </button>
          ))}
        </div>
      )}

      {dialog?.kind === "add" && (
        <AddDeviceDialog
          onClose={() => setDialog(null)}
          scanning={devices.scanning}
          onScan={() => {
            setDialog(null);
            void refresh(true);
          }}
          onAdd={async (ip, alias, hidden) => {
            const d = await devices.addByIp(ip, { alias: alias.trim() || undefined, hidden: hidden || undefined });
            notify(`Added ${alias.trim() || d.name}`);
          }}
        />
      )}
      {dialog?.kind === "edit" && dlgDevice && (
        <EditDeviceDialog
          key={dlgDevice.ip}
          device={dlgDevice}
          live={sockets.live[dlgDevice.ip]}
          now={now}
          onClose={() => setDialog(null)}
          onSave={(p) => devices.updateDevice(dlgDevice.ip, p)}
          onDelete={() => setDialog({ kind: "delete", ip: dlgDevice.ip })}
        />
      )}
      {dialog?.kind === "delete" && dlgDevice && (
        <ConfirmDeleteDialog
          device={dlgDevice}
          live={sockets.live[dlgDevice.ip]}
          now={now}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            devices.removeDevice(dlgDevice.ip);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "settings" && (
        <SettingsDialog settings={settings} update={updateSettings} onClose={() => setDialog(null)} />
      )}

      {toast && <div className="snackbar">{toast}</div>}
    </div>
  );
}
