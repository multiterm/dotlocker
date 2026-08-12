export type PlutoTheme = "Aurora" | "Midnight" | "Paper" | "Mono";
export type PlutoMode = "dark" | "light";

export const plutoThemes: PlutoTheme[] = ["Mono", "Aurora", "Midnight", "Paper"];
export const plutoModes: PlutoMode[] = ["dark", "light"];

export const themeLabels: Record<PlutoTheme, string> = {
  Aurora: "Aurora",
  Midnight: "Midnight",
  Paper: "Paper",
  Mono: "Mono",
};
