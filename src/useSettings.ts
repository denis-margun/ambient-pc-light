import { useEffect, useState } from "react";

export type ThemeSetting = "auto" | "light" | "dark";

export interface Settings {
  theme: ThemeSetting;
  showOfflineLast: boolean;
  showHidden: boolean;
  autoDiscover: boolean;
}

const KEY = "wled-pc-control.settings";
const DEFAULTS: Settings = { theme: "auto", showOfflineLast: true, showHidden: false, autoDiscover: true };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    const root = document.documentElement;
    if (settings.theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings]);

  const update = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));
  return { settings, update };
}
