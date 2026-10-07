import { useState } from "react";
import { SWATCHES } from "../color";

export function Toggle({
  on,
  onChange,
  disabled,
  title,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`toggle ${on ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    >
      <span className="knob" />
    </button>
  );
}

export function Slider({
  value,
  min = 0,
  max = 255,
  onChange,
  label,
  disabled,
  accent,
  format,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  label?: string;
  disabled?: boolean;
  accent?: string;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className={`slider ${disabled ? "disabled" : ""}`}>
      {label && (
        <span className="slider-head">
          <span>{label}</span>
          <span className="slider-val">{format ? format(value) : value}</span>
        </span>
      )}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(90deg, ${accent ?? "var(--accent)"} ${pct}%, var(--track) ${pct}%)`,
        }}
      />
    </label>
  );
}

export function Swatches({
  value,
  onPick,
  disabled,
}: {
  value: string;
  onPick: (hex: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          className={`swatch ${value.toLowerCase() === c ? "active" : ""}`}
          style={{ background: c }}
          onClick={() => onPick(c)}
          title={c}
        />
      ))}
      <label className="swatch custom" title="Свой цвет">
        <input type="color" value={value} disabled={disabled} onChange={(e) => onPick(e.target.value)} />
        <span style={{ background: value }} />
      </label>
    </div>
  );
}

/** <select> with an inline text filter — WLED has 180+ effects. */
export function SearchSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  options: { id: number; name: string }[];
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = query ? options.filter((o) => o.name.toLowerCase().includes(query)) : options;
  const current = options.find((o) => o.id === value);
  const list = current && !filtered.includes(current) ? [current, ...filtered] : filtered;
  return (
    <div className="search-select">
      <input
        className="search-input"
        placeholder={placeholder ?? "Поиск…"}
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
      />
      <select value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Turn WLED name lists into options, dropping reserved slots. */
export function toOptions(names?: string[]) {
  return (names ?? [])
    .map((name, id) => ({ id, name }))
    .filter((o) => o.name && o.name !== "RSVD" && o.name !== "-");
}
