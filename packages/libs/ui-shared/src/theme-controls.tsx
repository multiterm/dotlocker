import { themeLabels, type PlutoTheme } from "@dotlocker/gds";
import { usePlutoTheme } from "@dotlocker/ui";

const control = "grid h-9 place-items-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] text-xs text-[var(--pl-muted)] transition-colors hover:border-[var(--pl-line-strong)] hover:text-[var(--pl-text)]";

export function ModeToggle() {
  const { mode, setMode } = usePlutoTheme();
  const next = mode === "dark" ? "light" : "dark";
  return (
    <button type="button" className={`${control} w-9 cursor-pointer`} onClick={() => setMode(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {mode === "dark" ? "◐" : "◑"}
    </button>
  );
}

export function ThemeVariantSelect() {
  const { theme, themes, setTheme } = usePlutoTheme();
  return (
    <select
      aria-label="Theme palette"
      className={`${control} min-w-24 px-2.5 outline-none focus:border-[var(--pl-primary)]`}
      value={theme}
      onChange={(event) => setTheme(event.target.value as PlutoTheme)}
    >
      {themes.map((value) => <option key={value} value={value}>{themeLabels[value]}</option>)}
    </select>
  );
}
