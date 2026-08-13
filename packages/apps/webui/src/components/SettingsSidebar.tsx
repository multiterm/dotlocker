import { Link } from "@tanstack/react-router";
import { Separator, cn } from "@dotlocker/ui";

const settingsItems = [
  ["/settings", "General", "⌂"],
  ["/settings/webhooks", "Webhooks", "↗"],
  ["/settings/integrations", "Integrations", "◇"],
] as const;
const administrationItems = [
  ["/users", "Users & access", "○"],
  ["/tokens", "API keys & sessions", "⌁"],
  ["/logs", "Admin logs", "◎"],
] as const;

const linkClass =
  "flex h-10 items-center gap-3 whitespace-nowrap rounded-[var(--pl-radius-xs)] border border-transparent px-3 text-sm font-medium text-[var(--pl-muted)] no-underline transition-all hover:bg-[var(--pl-surface)] hover:text-[var(--pl-text)]";
const activeClass =
  "border-[color-mix(in_srgb,var(--pl-primary)_24%,var(--pl-line))] bg-[var(--pl-surface-2)] !text-[var(--pl-primary)] shadow-[0_1px_2px_rgb(0_0_0/.04)]";

type SettingsPath = (typeof settingsItems)[number][0] | (typeof administrationItems)[number][0];

function SettingsLink({ to, label, icon }: { to: SettingsPath; label: string; icon: string }) {
  return (
    <Link
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
  );
}

export function SettingsSidebar() {
  return (
    <aside className="min-w-0 self-stretch overflow-y-auto border-r border-[var(--pl-line)] bg-[var(--pl-elevated)] px-3 py-5 max-md:overflow-visible max-md:border-b max-md:border-r-0 max-md:py-3">
      <nav
        className="grid gap-3 max-md:flex max-md:overflow-x-auto"
        aria-label="Settings navigation"
      >
        <div className="grid gap-1 max-md:flex">
          {settingsItems.map(([to, label, icon]) => (
            <SettingsLink key={to} to={to} label={label} icon={icon} />
          ))}
        </div>
        <Separator className="max-md:h-auto max-md:w-px max-md:self-stretch" />
        <div className="grid gap-1 max-md:flex">
          {administrationItems.map(([to, label, icon]) => (
            <SettingsLink key={to} to={to} label={label} icon={icon} />
          ))}
        </div>
      </nav>
    </aside>
  );
}
