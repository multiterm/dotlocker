import { Link } from "@tanstack/react-router";
import { Text, cn } from "@dotlocker/ui";

const groups = [
  {
    label: "Settings",
    items: [
      ["/settings", "General", "⌂"],
      ["/settings/webhooks", "Webhooks", "↗"],
      ["/settings/integrations", "Integrations", "◇"],
    ],
  },
  {
    label: "Administration",
    items: [
      ["/users", "Users & access", "○"],
      ["/tokens", "API keys & sessions", "⌁"],
      ["/logs", "Admin logs", "◎"],
    ],
  },
] as const;

const linkClass =
  "flex h-10 items-center gap-3 whitespace-nowrap rounded-[var(--pl-radius-xs)] border border-transparent px-3 text-sm font-medium text-[var(--pl-muted)] no-underline transition-all hover:bg-[var(--pl-surface)] hover:text-[var(--pl-text)]";
const activeClass =
  "border-[color-mix(in_srgb,var(--pl-primary)_24%,var(--pl-line))] bg-[var(--pl-surface-2)] !text-[var(--pl-primary)] shadow-[0_1px_2px_rgb(0_0_0/.04)]";

export function SettingsSidebar() {
  return (
    <aside className="flex h-full min-w-0 flex-col self-stretch overflow-y-auto border-r border-[var(--pl-line)] bg-[var(--pl-elevated)] px-3 py-5 max-md:h-auto max-md:overflow-visible max-md:border-b max-md:border-r-0 max-md:py-3">
      <div className="mb-5 px-2.5 max-md:hidden">
        <Text as="h2" variant="title">
          Settings & admin
        </Text>
        <Text className="mt-1 text-xs text-[var(--pl-subtle)]">
          Organization configuration and administration.
        </Text>
      </div>
      <nav
        className="grid gap-5 max-md:flex max-md:gap-3 max-md:overflow-x-auto"
        aria-label="Settings and administration navigation"
      >
        {groups.map((group) => (
          <section key={group.label} className="min-w-max md:min-w-0">
            <Text variant="label" className="mb-2 h-4 px-2.5 text-[var(--pl-subtle)]">
              {group.label}
            </Text>
            <div className="grid gap-1 max-md:flex">
              {group.items.map(([to, label, icon]) => (
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
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
