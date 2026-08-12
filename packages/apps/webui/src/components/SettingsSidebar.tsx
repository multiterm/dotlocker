import { Link } from "@tanstack/react-router";
import { Text, cn } from "@dotlocker/ui";

const categories = [
  ["/settings", "General", "⌂"],
  ["/settings/webhooks", "Webhooks", "↗"],
  ["/settings/integrations", "Integrations", "◇"],
] as const;

const linkClass =
  "flex h-10 items-center gap-3 whitespace-nowrap rounded-[var(--pl-radius-xs)] border border-transparent px-3 text-sm font-medium text-[var(--pl-muted)] no-underline transition-all hover:bg-[var(--pl-surface)] hover:text-[var(--pl-text)]";
const activeClass =
  "border-[color-mix(in_srgb,var(--pl-primary)_24%,var(--pl-line))] bg-[var(--pl-surface-2)] !text-[var(--pl-primary)] shadow-[0_1px_2px_rgb(0_0_0/.04)]";

export function SettingsSidebar() {
  return (
    <aside className="h-full min-w-0 self-stretch overflow-y-auto border-r border-[var(--pl-line)] bg-[var(--pl-elevated)] px-3 py-5 max-md:h-auto max-md:overflow-visible max-md:border-b max-md:border-r-0 max-md:py-3">
      <Text variant="label" className="mb-2 h-4 px-2.5 text-[var(--pl-subtle)]">
        Settings
      </Text>
      <nav
        className="grid gap-1 max-md:flex max-md:overflow-x-auto"
        aria-label="Settings navigation"
      >
        {categories.map(([to, label, icon]) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true, includeSearch: false }}
            className={linkClass}
            activeProps={{ className: cn(linkClass, activeClass) }}
          >
            <span className="grid w-4 place-items-center" aria-hidden>
              {icon}
            </span>
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
