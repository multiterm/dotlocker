import { useEffect, useState, type ReactNode } from "react";
import { applyPlutoTheme, plutoThemes, plutoModes, type PlutoMode, type PlutoTheme } from "@dotlocker/gds";

// Shared cross-app preferences cookie (mirrors honeycluster/portal `ui-preferences`).
// `theme` holds the light/dark mode (portal-compatible); `themeVariant` is the
// Pluto-only palette and is ignored by other apps. Scoped to the registrable
// parent domain (`.dotlocker.dev`) so dot.locker subdomains share one preference.
const COOKIE = "ui-preferences";

interface Prefs {
  theme?: "light" | "dark" | "system";
  themeVariant?: string;
  [key: string]: unknown;
}

function cookieDomain(): string | undefined {
  const host = location.hostname;
  if (host === "localhost" || /^[0-9.]+$/.test(host)) return undefined;
  const parts = host.split(".");
  if (parts.length <= 1) return undefined;
  return "." + parts.slice(-2).join(".");
}

function readPrefs(): Prefs {
  if (typeof document === "undefined") return {};
  const match = document.cookie.split("; ").find((c) => c.startsWith(COOKIE + "="));
  if (!match) return {};
  try {
    return JSON.parse(decodeURIComponent(match.slice(COOKIE.length + 1))) as Prefs;
  } catch {
    return {};
  }
}

function writePrefs(patch: Prefs): void {
  if (typeof document === "undefined") return;
  const merged = { ...readPrefs(), ...patch };
  const secure = location.protocol === "https:";
  const domain = cookieDomain();
  let cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(merged))}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=${secure ? "None" : "Lax"}`;
  if (secure) cookie += "; Secure";
  if (domain) cookie += `; Domain=${domain}`;
  document.cookie = cookie;
}

function systemMode(): PlutoMode {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveMode(theme: Prefs["theme"]): PlutoMode {
  if (theme === "light" || theme === "dark") return theme;
  if (theme === "system") return systemMode();
  return "dark";
}

function resolveVariant(variant: unknown): PlutoTheme {
  return typeof variant === "string" && plutoThemes.includes(variant as PlutoTheme) ? (variant as PlutoTheme) : "Mono";
}

const themeKey = "pluto.theme";
const modeKey = "pluto.mode";

export function usePlutoTheme() {
  const [theme, setThemeState] = useState<PlutoTheme>(() => {
    const prefs = readPrefs();
    if (prefs.themeVariant !== undefined) return resolveVariant(prefs.themeVariant);
    return resolveVariant(typeof localStorage !== "undefined" ? localStorage.getItem(themeKey) : null);
  });
  const [mode, setModeState] = useState<PlutoMode>(() => {
    const prefs = readPrefs();
    if (prefs.theme !== undefined) return resolveMode(prefs.theme);
    const legacy = typeof localStorage !== "undefined" ? localStorage.getItem(modeKey) : null;
    return legacy === "light" || legacy === "dark" ? legacy : "dark";
  });

  useEffect(() => {
    applyPlutoTheme(theme, mode);
  }, [theme, mode]);

  useEffect(() => {
    const sync = () => {
      const prefs = readPrefs();
      setModeState(resolveMode(prefs.theme));
      if (prefs.themeVariant !== undefined) setThemeState(resolveVariant(prefs.themeVariant));
    };
    window.addEventListener("focus", sync);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if ((readPrefs().theme ?? "") === "system") setModeState(systemMode());
    };
    mq.addEventListener("change", onSystem);
    return () => {
      window.removeEventListener("focus", sync);
      mq.removeEventListener("change", onSystem);
    };
  }, []);

  const setTheme = (next: PlutoTheme) => {
    setThemeState(next);
    writePrefs({ themeVariant: next });
  };
  const setMode = (next: PlutoMode) => {
    setModeState(next);
    writePrefs({ theme: next });
  };

  return { theme, mode, themes: plutoThemes, modes: plutoModes, setTheme, setMode };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  usePlutoTheme();
  return <>{children}</>;
}
