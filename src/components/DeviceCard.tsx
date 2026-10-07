import { memo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { displayColor, hexToRgb, rgbToHex } from "../color";
import type { DeviceRuntime, SavedDevice } from "../types";
import type { StatePatch } from "../useWled";
import { SearchSelect, Slider, Swatches, Toggle, toOptions } from "./Controls";

interface Props {
  device: SavedDevice;
  rt?: DeviceRuntime;
  selected: boolean;
  onSelect: () => void;
  onSend: (patch: StatePatch) => void;
  onRemove: () => void;
  onRename: (alias: string) => void;
  onMove: (dir: -1 | 1) => void;
  onReload: () => void;
}

const SLOT_NAMES = ["Основной", "Фон", "Третий"];

function signalBars(signal?: number) {
  if (signal === undefined) return "";
  return signal > 75 ? "▂▄▆█" : signal > 50 ? "▂▄▆" : signal > 25 ? "▂▄" : "▂";
}

export const DeviceCard = memo(function DeviceCard({
  device,
  rt,
  selected,
  onSelect,
  onSend,
  onRemove,
  onRename,
  onMove,
  onReload,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [slot, setSlot] = useState(0);
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(device.alias ?? "");
  const [confirmDel, setConfirmDel] = useState(false);

  const state = rt?.state;
  const info = rt?.info;
  const seg = state?.seg?.find((s) => s.sel !== false) ?? state?.seg?.[0];
  const online = !!rt?.online;
  const disabled = !online || !state;
  const isOn = !!state?.on;
  const color = seg?.col?.[0];
  const glow = isOn && online ? displayColor(color) : "transparent";
  const title = device.alias || info?.name || device.name;

  const effects = toOptions(rt?.effects);
  const palettes = toOptions(rt?.palettes);

  const setColor = (hex: string) => {
    const rgb = hexToRgb(hex);
    const col: (number[] | [])[] = [[], [], []];
    col[slot] = rgb;
    // "[]" keeps the other color slots unchanged
    onSend({ on: true, seg: { col } });
  };

  return (
    <article
      className={`card ${isOn && online ? "lit" : ""} ${online ? "" : "offline"} ${selected ? "selected" : ""}`}
      style={{ ["--glow" as string]: glow }}
    >
      <header className="card-head">
        <input
          type="checkbox"
          className="check"
          checked={selected}
          onChange={onSelect}
          title="Выбрать для группового управления"
        />
        <div className="bulb" style={{ background: isOn && online ? glow : undefined }} />
        <div className="card-title">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onRename(alias);
                setEditing(false);
              }}
            >
              <input
                autoFocus
                className="rename"
                value={alias}
                placeholder={info?.name || device.name}
                onChange={(e) => setAlias(e.target.value)}
                onBlur={() => {
                  onRename(alias);
                  setEditing(false);
                }}
              />
            </form>
          ) : (
            <h3 onDoubleClick={() => setEditing(true)} title="Двойной клик — переименовать">
              {title}
            </h3>
          )}
          <span className="sub">
            <span className={`dot ${online ? "ok" : rt?.loading ? "wait" : "bad"}`} />
            {device.ip}
            {info && <> · {info.leds.count} LED</>}
          </span>
        </div>
        <Toggle on={isOn} disabled={disabled} onChange={(v) => onSend({ on: v })} title="Вкл/выкл" />
      </header>

      {!online && !rt?.loading && (
        <div className="offline-msg">
          Нет связи с устройством
          <button className="link" onClick={onReload}>
            Повторить
          </button>
        </div>
      )}

      <Slider
        label="Яркость"
        value={state?.bri ?? 0}
        min={1}
        max={255}
        disabled={disabled}
        accent={glow !== "transparent" ? glow : undefined}
        format={(v) => `${Math.round((v / 255) * 100)}%`}
        onChange={(bri) => onSend({ bri })}
      />

      <div className="slots">
        {SLOT_NAMES.map((n, i) => (
          <button
            key={n}
            className={`slot ${slot === i ? "active" : ""}`}
            onClick={() => setSlot(i)}
            disabled={disabled}
          >
            <span style={{ background: rgbToHex(seg?.col?.[i]) }} />
            {n}
          </button>
        ))}
      </div>
      <Swatches value={rgbToHex(seg?.col?.[slot])} onPick={setColor} disabled={disabled} />

      {rt?.presets && rt.presets.length > 0 && (
        <div className="presets">
          {rt.presets.map((p) => (
            <button
              key={p.id}
              className={`chip ${state?.ps === p.id ? "active" : ""}`}
              disabled={disabled}
              onClick={() => onSend({ ps: p.id })}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <button className="expander" onClick={() => setExpanded((x) => !x)}>
        {expanded ? "▲ Скрыть эффекты" : "▼ Эффекты и палитры"}
        {seg && rt?.effects && !expanded && <span className="muted"> · {rt.effects[seg.fx]}</span>}
      </button>

      {expanded && seg && (
        <div className="fx">
          <span className="field-label">Эффект</span>
          <SearchSelect
            options={effects}
            value={seg.fx}
            disabled={disabled}
            onChange={(fx) => onSend({ on: true, seg: { fx } })}
          />
          <Slider label="Скорость" value={seg.sx} disabled={disabled} onChange={(sx) => onSend({ seg: { sx } })} />
          <Slider
            label="Интенсивность"
            value={seg.ix}
            disabled={disabled}
            onChange={(ix) => onSend({ seg: { ix } })}
          />
          <span className="field-label">Палитра</span>
          <SearchSelect
            options={palettes}
            value={seg.pal}
            disabled={disabled}
            onChange={(pal) => onSend({ seg: { pal } })}
          />
          {state?.nl && (
            <div className="row between">
              <span>Ночник ({state.nl.dur} мин)</span>
              <Toggle on={state.nl.on} disabled={disabled} onChange={(on) => onSend({ nl: { on } })} />
            </div>
          )}
        </div>
      )}

      <footer className="card-foot">
        <span className="muted">
          {info ? `v${info.ver}` : ""}
          {info?.wifi?.signal !== undefined && <> · {signalBars(info.wifi.signal)}</>}
          {info?.leds.pwr ? <> · {(info.leds.pwr / 1000).toFixed(2)} A</> : null}
          {state && state.seg.length > 1 && <> · {state.seg.length} сегм.</>}
        </span>
        <span className="actions">
          <button className="icon" title="Выше" onClick={() => onMove(-1)}>↑</button>
          <button className="icon" title="Ниже" onClick={() => onMove(1)}>↓</button>
          <button className="icon" title="Обновить" onClick={onReload}>⟳</button>
          <button className="icon" title="Открыть веб-интерфейс WLED" onClick={() => openUrl(`http://${device.ip}`)}>
            ↗
          </button>
          <button
            className={`icon danger ${confirmDel ? "confirm" : ""}`}
            title="Удалить из списка"
            onClick={() => (confirmDel ? onRemove() : setConfirmDel(true))}
            onMouseLeave={() => setConfirmDel(false)}
          >
            {confirmDel ? "Удалить?" : "✕"}
          </button>
        </span>
      </footer>
    </article>
  );
});
