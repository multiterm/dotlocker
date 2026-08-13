import { createRoute, Outlet, useMatches } from "@tanstack/react-router";
import { ScrollArea, Text } from "@dotlocker/ui";
import { AppRoute } from "./app";
import { SettingsSidebar } from "~webui/components/SettingsSidebar";

export const SettingsLayoutRoute = createRoute({
  getParentRoute: () => AppRoute,
  id: "settings-layout",
  staticData: { shellLayout: "secondary" },
  component: SettingsLayout,
});

const headers: Record<string, [string, string]> = {
  "/settings": ["General settings", "Organization, connection, and dashboard preferences."],
  "/users": ["Users & access", "Provision Keyname identities and manage organization access."],
  "/tokens": ["API keys & sessions", "Manage scoped credentials and active browser sessions."],
  "/logs": ["Admin logs", "Review and export organization security and activity events."],
  "/settings/webhooks": ["Webhooks", "Deliver signed dot.locker events to your systems."],
  "/settings/integrations": [
    "Integrations",
    "Connect dot.locker to deployment and automation platforms.",
  ],
};

function SettingsLayout() {
  const path = useMatches().at(-1)?.pathname ?? "/settings";
  const [title, description] = headers[path] ?? headers["/settings"]!;
  return (
    <div className="grid min-h-[calc(100vh-7rem)] min-w-0 grid-cols-[216px_minmax(0,1fr)] max-md:grid-cols-1">
      <SettingsSidebar />
      <ScrollArea className="grid min-w-0 content-start gap-5 overflow-y-auto p-5 pb-20 max-md:overflow-visible max-sm:p-3 max-sm:pb-24 xl:p-6 xl:pb-20">
        <section className="mb-1">
          <Text as="h1" variant="page">
            {title}
          </Text>
          <Text className="mt-1 text-[13px] text-[var(--pl-muted)]">{description}</Text>
        </section>
        <Outlet />
      </ScrollArea>
    </div>
  );
}
