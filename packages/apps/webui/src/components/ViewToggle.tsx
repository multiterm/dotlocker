import { useState } from "react";
import { cn } from "@dotlocker/ui";

export type CollectionView = "list" | "grid";

export function ViewToggle({
  value,
  onChange,
}: {
  value: CollectionView;
  onChange(value: CollectionView): void;
}) {
  return (
    <div
      className="inline-flex rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] p-0.5"
      role="group"
      aria-label="Collection view"
    >
      {(["list", "grid"] as const).map((view) => (
        <button
          key={view}
          type="button"
          title={`${view[0]!.toUpperCase()}${view.slice(1)} view`}
          aria-pressed={value === view}
          onClick={() => onChange(view)}
          className={cn(
            "grid h-8 w-8 place-items-center rounded border-0 bg-transparent px-0 text-[var(--pl-muted)]",
            value === view && "bg-[var(--pl-elevated)] text-[var(--pl-primary)] shadow-sm",
          )}
        >
          <span aria-hidden>{view === "list" ? "☷" : "▦"}</span>
          <span className="sr-only">{view} view</span>
        </button>
      ))}
    </div>
  );
}

export function useStoredView(key: string): [CollectionView, (value: CollectionView) => void] {
  const stored = localStorage.getItem(key);
  const initial: CollectionView = stored === "grid" ? "grid" : "list";
  const [view, setView] = useState<CollectionView>(initial);
  return [
    view,
    (next) => {
      localStorage.setItem(key, next);
      setView(next);
    },
  ];
}
