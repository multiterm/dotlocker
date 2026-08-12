import { Link, Outlet, useMatches, useNavigate } from "@tanstack/react-router";
import { Badge, Button, ScrollArea, Text, cn } from "@multiterm/pluto-ui";
import { DotbaseBrand, ModeToggle, ThemeVariantSelect } from "@multiterm/pluto-ui-shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog } from "~webui/components/Dialog";
import { useSession } from "~webui/lib/session";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    shellLayout?: "default" | "secondary";
  }
}

interface NavigationItem {
  readonly to: string;
  readonly label: string;
  readonly icon: string;
}

const workspaceNav: readonly NavigationItem[] = [
  { to: "/", label: "Overview", icon: "⌂" },
  { to: "/files", label: "Files", icon: "□" },
  { to: "/repos", label: "Repositories", icon: "◇" },
];
const accessNav: readonly NavigationItem[] = [
  { to: "/users", label: "Users", icon: "○" },
  { to: "/tokens", label: "API Keys", icon: "⌁" },
  { to: "/logs", label: "Admin logs", icon: "◎" },
];
const accountNav: readonly NavigationItem[] = [{ to: "/settings", label: "Settings", icon: "⚙" }];

const titles: Record<string, [string, string]> = {
  "/": ["Overview", "Operational status and identity."],
  "/files": ["Files", "Browse and manage runtime-scoped files."],
  "/repos": ["Repositories", "Manage projects and runtime repositories."],
  "/users": ["Users", "Provision accounts for Keyname sign-in."],
  "/tokens": ["API Keys", "Manage scoped keys and their access rights."],
  "/logs": ["Admin logs", "Review all recorded Dotbase organization events."],
};

const sideLink =
  "group flex h-10 items-center gap-3 whitespace-nowrap rounded-[var(--pl-radius-xs)] border border-transparent px-3 text-sm font-medium text-[var(--pl-muted)] no-underline transition-all hover:bg-[var(--pl-surface)] hover:text-[var(--pl-text)]";
const activeSideLink =
  "border-[color-mix(in_srgb,var(--pl-primary)_24%,var(--pl-line))] bg-[var(--pl-surface-2)] !text-[var(--pl-primary)] shadow-[0_1px_2px_rgb(0_0_0/.04)]";

function SidebarIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16" />
      <path d={collapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"} />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </svg>
  );
}

function NavigationGroup({
  label,
  items,
  collapsed,
}: {
  label: string;
  items: readonly NavigationItem[];
  collapsed: boolean;
}) {
  return (
    <div className="min-w-max lg:min-w-0">
      <Text
        variant="label"
        className={cn(
          "mb-2 h-4 px-2.5 text-[var(--pl-subtle)] max-lg:hidden",
          collapsed && "lg:invisible lg:w-0 lg:overflow-hidden lg:px-0",
        )}
      >
        {label}
      </Text>
      <div className="flex gap-1 lg:grid">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            activeOptions={{ exact: item.to !== "/settings", includeSearch: false }}
            className={cn(sideLink, collapsed && "lg:mx-auto lg:w-10 lg:justify-center lg:px-0")}
            activeProps={{ className: activeSideLink }}
          >
            <span className="grid w-4 shrink-0 place-items-center text-[14px]" aria-hidden>
              {item.icon}
            </span>
            <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function organizationMark(name: string): string {
  return name
    .split(/[-_. ]/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function OrganizationSwitcher({
  activeOrg,
  organizations,
  disabled,
  onSelect,
  onAdd,
}: {
  activeOrg: string;
  organizations: string[];
  disabled: boolean;
  onSelect(org: string): Promise<void>;
  onAdd(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-full items-center gap-2 rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] px-2.5 text-left text-[var(--pl-text)] transition-colors hover:bg-[var(--pl-surface-2)] disabled:pointer-events-none disabled:opacity-60"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--pl-radius-xs)] bg-[var(--pl-primary)] text-[9px] font-bold text-[var(--pl-bg)]">
          {organizationMark(activeOrg)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{activeOrg}</span>
        <span
          aria-hidden
          className={`text-[10px] text-[var(--pl-subtle)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ⌄
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Organization"
          className="pl-popover-enter absolute left-0 right-0 top-12 z-50 rounded-[var(--pl-radius-sm)] border border-[var(--pl-line)] bg-[var(--pl-elevated)] p-1.5 shadow-[var(--pl-shadow-hard)]"
        >
          <Text variant="label" className="px-2 py-1.5 text-[var(--pl-subtle)]">
            Existing organizations
          </Text>
          {organizations.map((name) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={name === activeOrg}
              onClick={() => {
                setOpen(false);
                void onSelect(name);
              }}
              className={`flex w-full items-center gap-2 rounded-[var(--pl-radius-xs)] border-0 px-2 py-2 text-left text-xs ${
                name === activeOrg
                  ? "bg-[var(--pl-surface-2)] text-[var(--pl-primary)]"
                  : "bg-transparent text-[var(--pl-muted)] hover:bg-[var(--pl-surface)] hover:text-[var(--pl-text)]"
              }`}
            >
              <span className="grid h-7 w-7 place-items-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] text-[9px] font-bold">
                {organizationMark(name)}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
              {name === activeOrg && <span aria-hidden>✓</span>}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--pl-line)]" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
            className="flex w-full items-center gap-2 rounded-[var(--pl-radius-xs)] border-0 bg-transparent px-2 py-2 text-left text-xs font-semibold text-[var(--pl-muted)] hover:bg-[var(--pl-surface)] hover:text-[var(--pl-text)]"
          >
            <span className="grid h-7 w-7 place-items-center rounded-[var(--pl-radius-xs)] border border-dashed border-[var(--pl-line)] text-base">
              +
            </span>
            Add new organization
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { me, org, server, api, setOrg, setMe, logout } = useSession();
  const navigate = useNavigate();
  const matches = useMatches();
  const pathname = matches.at(-1)?.pathname ?? "/";
  const settingsPage = matches.some((match) => match.staticData.shellLayout === "secondary");
  const [title, subtitle] = titles[pathname] ?? ["Dotbase", "Runtime-aware file infrastructure."];
  const [loggingOut, setLoggingOut] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [addOrgOpen, setAddOrgOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [orgError, setOrgError] = useState("");
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("pluto.sidebar.collapsed") === "1",
  );
  const initials = (me?.token.userEmail ?? "P").slice(0, 2).toUpperCase();

  useEffect(() => {
    void api
      .me()
      .then((next) => {
        setMe(next);
        setOrg(next.token.org);
      })
      .catch(() => location.assign("/login"));
  }, [api, setMe, setOrg]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await Promise.allSettled([api.logout(), window.Keyname.signOut()]);
    logout();
    await navigate({ to: "/login" });
    setLoggingOut(false);
  };

  const handleOrganizationChange = async (nextOrg: string) => {
    if (!nextOrg || nextOrg === org || switchingOrg) return;
    setSwitchingOrg(true);
    setOrgError("");
    try {
      const next = await api.switchOrg(nextOrg);
      setMe(next);
      setOrg(next.token.org);
    } catch (reason) {
      setOrgError(`Could not switch organization: ${JSON.stringify(reason)}`);
    } finally {
      setSwitchingOrg(false);
    }
  };

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    const name = newOrgName.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(name)) {
      setOrgError("Use 2–63 lowercase letters, numbers, or hyphens, starting with a letter.");
      return;
    }
    setSwitchingOrg(true);
    setOrgError("");
    try {
      await api.createOrganization(name);
      const next = await api.switchOrg(name);
      setMe(next);
      setOrg(next.token.org);
      setAddOrgOpen(false);
      setNewOrgName("");
    } catch (reason) {
      setOrgError(`Could not create organization: ${JSON.stringify(reason)}`);
    } finally {
      setSwitchingOrg(false);
    }
  };

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("pluto.sidebar.collapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <>
      <div
        className={cn(
          "grid h-[calc(100vh-3rem)] w-full overflow-hidden bg-[var(--pl-bg)] text-[var(--pl-text)] transition-[grid-template-columns] duration-200 max-lg:h-auto max-lg:min-h-[calc(100vh-3rem)] max-lg:grid-cols-1 max-lg:overflow-visible",
          collapsed ? "lg:grid-cols-[68px_minmax(0,1fr)]" : "lg:grid-cols-[216px_minmax(0,1fr)]",
        )}
      >
        <aside className="sticky top-0 z-30 flex h-full min-w-0 flex-col overflow-hidden border-r border-[var(--pl-line)] bg-[var(--pl-elevated)] max-lg:relative max-lg:h-auto max-lg:border-b max-lg:border-r-0">
          <div
            className={cn(
              "flex h-16 shrink-0 items-center border-b border-[var(--pl-line)] max-lg:px-5",
              collapsed ? "lg:justify-center lg:px-2" : "px-5",
            )}
          >
            <DotbaseBrand className={cn("text-[var(--pl-text)]", collapsed && "lg:hidden")} />
            {collapsed && <DotbaseBrand variant="mark" className="hidden lg:inline-flex" />}
          </div>

          <div
            className={cn(
              "border-b border-[var(--pl-line)] py-4 max-lg:hidden",
              collapsed ? "px-2" : "px-3",
            )}
          >
            {!collapsed && (
              <Text variant="label" className="mb-2 px-2 text-[var(--pl-subtle)]">
                Organization
              </Text>
            )}
            {collapsed ? (
              <button
                type="button"
                title={org}
                className="mx-auto grid h-10 w-10 place-items-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] text-xs font-bold text-[var(--pl-primary)]"
                onClick={() => setAddOrgOpen(true)}
              >
                {org.slice(0, 2).toUpperCase()}
              </button>
            ) : (
              <OrganizationSwitcher
                activeOrg={org}
                organizations={me?.orgs.length ? me.orgs : [org]}
                disabled={switchingOrg || !me}
                onSelect={handleOrganizationChange}
                onAdd={() => setAddOrgOpen(true)}
              />
            )}
          </div>

          <nav
            className={cn(
              "pl-scrollbar grid min-h-0 flex-1 content-start gap-5 overflow-y-auto py-5 max-lg:flex max-lg:overflow-x-auto max-lg:px-3 max-lg:py-3",
              collapsed ? "lg:px-2" : "lg:px-3",
            )}
          >
            <NavigationGroup label="Workspace" items={workspaceNav} collapsed={collapsed} />
            <NavigationGroup label="Administration" items={accessNav} collapsed={collapsed} />
            <NavigationGroup label="Account" items={accountNav} collapsed={collapsed} />
          </nav>

          {!collapsed && (
            <div className="mx-3 mb-4 rounded-[var(--pl-radius-sm)] border border-[var(--pl-line)] bg-[var(--pl-surface)] p-3.5 max-lg:hidden">
              <Text variant="title">Need help?</Text>
              <Text className="mt-1 text-xs leading-relaxed text-[var(--pl-muted)]">
                Find setup guides and API references in Dotbase documentation.
              </Text>
              <a
                href="https://github.com/super-repo/pluto"
                className="mt-3 inline-flex text-xs font-semibold text-[var(--pl-primary)] no-underline hover:underline"
              >
                View documentation →
              </a>
            </div>
          )}
        </aside>

        <div className="flex h-full min-h-0 min-w-0 flex-col max-lg:h-auto">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-[var(--pl-line)] bg-[color-mix(in_srgb,var(--pl-elevated)_94%,transparent)] px-5 backdrop-blur-lg max-lg:hidden">
            <button
              type="button"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="grid h-9 w-9 place-items-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] text-[var(--pl-muted)] hover:text-[var(--pl-text)]"
              onClick={toggleSidebar}
            >
              <SidebarIcon collapsed={collapsed} />
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeVariantSelect />
              <ModeToggle />
              <div className="ml-1 flex items-center gap-2 border-l border-[var(--pl-line)] pl-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--pl-surface-2)] text-xs font-bold text-[var(--pl-primary)]">
                  {initials}
                </span>
                <div className="w-36 min-w-0 max-xl:hidden">
                  <div className="truncate text-xs font-semibold">
                    {me?.token.userEmail ?? "Loading…"}
                  </div>
                  <div className="text-[11px] text-[var(--pl-subtle)]">Administrator</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Log out"
                  title="Log out"
                  className="h-8 w-8 px-0"
                  disabled={loggingOut}
                  onClick={() => void handleLogout()}
                >
                  <LogoutIcon />
                </Button>
              </div>
            </div>
          </header>

          <main className="min-h-0 min-w-0 flex-1 overflow-hidden max-lg:overflow-visible">
            <ScrollArea
              className={cn(
                "h-full max-lg:h-auto",
                settingsPage
                  ? "!overflow-hidden max-lg:!overflow-visible"
                  : "p-5 max-sm:p-3 xl:p-6",
              )}
            >
            {!settingsPage && (
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <Text as="h1" variant="page">
                    {title}
                  </Text>
                  <Text className="mt-1 text-[13px] text-[var(--pl-muted)]">{subtitle}</Text>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{org || "No organization"}</Badge>
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    API: {server || "same origin"}
                  </Badge>
                </div>
              </div>
            )}
            <div key={`${pathname}:${org}`} className="pl-page-enter">
              <Outlet />
            </div>
            </ScrollArea>
          </main>
        </div>
      </div>

      <footer className="z-40 flex min-h-12 w-full flex-wrap items-center justify-between gap-2 border-t border-[var(--pl-line)] bg-[color-mix(in_srgb,var(--pl-elevated)_96%,transparent)] px-6 py-3 text-[11px] text-[var(--pl-subtle)] backdrop-blur-lg max-sm:px-4">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-[var(--pl-muted)]">
            Dotbase Runtime Infrastructure
          </span>
          <span>v0.2.5</span>
        </div>
        <span>© {new Date().getFullYear()} Dotbase</span>
        <span className="inline-flex items-center gap-2 text-[var(--pl-muted)]">
          <i className="h-2 w-2 rounded-full bg-[var(--pl-success)]" />
          All systems operational
        </span>
      </footer>

      {addOrgOpen && (
        <Dialog title="Add organization" onClose={() => setAddOrgOpen(false)}>
          <form onSubmit={(event) => void createOrganization(event)}>
            <p className="mt-0 text-sm text-[var(--pl-muted)]">
              Create another organization. You will become its organization administrator.
            </p>
            <label htmlFor="new-organization-name">Organization name</label>
            <input
              id="new-organization-name"
              autoFocus
              required
              value={newOrgName}
              onChange={(event) => setNewOrgName(event.target.value)}
              placeholder="example-team"
              autoComplete="off"
            />
            {orgError && <p className="err mt-3 text-xs">{orgError}</p>}
            <div className="actions justify-end border-t border-[var(--pl-line)] pt-4">
              <button type="button" className="secondary" onClick={() => setAddOrgOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={switchingOrg}>
                {switchingOrg ? "Creating…" : "Create organization"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
