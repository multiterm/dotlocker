export * from "../tokens/index.js";

export function applyPlutoTheme(theme: string, mode: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.mode = mode;
}
