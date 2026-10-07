import type { RGB } from "./types";

export function rgbToHex(c?: RGB): string {
  if (!c) return "#000000";
  return (
    "#" +
    [c[0], c[1], c[2]]
      .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Perceived color for UI glow: white channel brightens the RGB part. */
export function displayColor(c?: RGB): string {
  if (!c) return "#666";
  const w = c[3] ?? 0;
  const mix = (v: number) => Math.min(255, v + w);
  return `rgb(${mix(c[0])}, ${mix(c[1])}, ${mix(c[2])})`;
}

export const SWATCHES: string[] = [
  "#ff0000", "#ff6a00", "#ffb300", "#ffe600", "#7dff00", "#00ff6a",
  "#00ffd5", "#00a2ff", "#0033ff", "#7a00ff", "#ff00d4", "#ffffff",
  "#ffd29a", "#ffb15c",
];
