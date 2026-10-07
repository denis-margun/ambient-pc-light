import { useState } from "react";
import { hexToRgb } from "../color";
import type { DeviceRuntime } from "../types";
import type { StatePatch } from "../useWled";
import { SearchSelect, Slider, Swatches, toOptions } from "./Controls";

interface Props {
  targets: string[];
  hasSelection: boolean;
  runtime: Record<string, DeviceRuntime>;
  send: (ips: string[], patch: StatePatch) => void;
}

/** Controls that act on several devices at once. Effects/palettes are matched by name,
 *  so devices on different WLED versions still get the right effect. */
export function GroupBar({ targets, hasSelection, runtime, send }: Props) {
  const [bri, setBri] = useState(128);
  const [hex, setHex] = useState("#ffb15c");
  const [fxName, setFxName] = useState<string>("");
  const [palName, setPalName] = useState<string>("");

  const ref = targets.map((ip) => runtime[ip]).find((r) => r?.effects);
  const effects = toOptions(ref?.effects);
  const palettes = toOptions(ref?.palettes);
  const disabled = targets.length === 0;

  const byName = (kind: "effects" | "palettes", name: string, key: "fx" | "pal") => {
    for (const ip of targets) {
      const idx = runtime[ip]?.[kind]?.indexOf(name) ?? -1;
      if (idx >= 0) send([ip], key === "fx" ? { on: true, seg: { fx: idx } } : { seg: { pal: idx } });
    }
  };

  const fxId = effects.find((e) => e.name === fxName)?.id ?? -1;
  const palId = palettes.find((e) => e.name === palName)?.id ?? -1;

  return (
    <section className="group">
      <div className="group-title">
        <strong>{hasSelection ? `Выбрано: ${targets.length}` : `Все устройства (${targets.length})`}</strong>
        <span className="muted">групповое управление</span>
      </div>
      <div className="group-grid">
        <div className="group-power">
          <button className="btn" disabled={disabled} onClick={() => send(targets, { on: true })}>
            Включить
          </button>
          <button className="btn ghost" disabled={disabled} onClick={() => send(targets, { on: false })}>
            Выключить
          </button>
        </div>
        <Slider
          label="Яркость"
          value={bri}
          min={1}
          disabled={disabled}
          format={(v) => `${Math.round((v / 255) * 100)}%`}
          onChange={(v) => {
            setBri(v);
            send(targets, { bri: v });
          }}
        />
        <Swatches
          value={hex}
          disabled={disabled}
          onPick={(h) => {
            setHex(h);
            send(targets, { on: true, seg: { col: [hexToRgb(h), [], []] } });
          }}
        />
        {effects.length > 0 && (
          <div className="group-selects">
            <SearchSelect
              options={[{ id: -1, name: "— эффект —" }, ...effects]}
              value={fxId}
              disabled={disabled}
              onChange={(id) => {
                const name = effects.find((e) => e.id === id)?.name;
                if (!name) return;
                setFxName(name);
                byName("effects", name, "fx");
              }}
            />
            <SearchSelect
              options={[{ id: -1, name: "— палитра —" }, ...palettes]}
              value={palId}
              disabled={disabled}
              onChange={(id) => {
                const name = palettes.find((e) => e.id === id)?.name;
                if (!name) return;
                setPalName(name);
                byName("palettes", name, "pal");
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
