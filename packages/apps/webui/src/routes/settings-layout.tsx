import { createRoute, Outlet, useMatches } from "@tanstack/react-router";
import { ScrollArea, Text } from "@multiterm/pluto-ui";
import { AppRoute } from "./app";
import { SettingsSidebar } from "~webui/components/SettingsSidebar";

export const SettingsLayoutRoute = createRoute({
  getParentRoute: () => AppRoute,
  id: "settings-layout",
  staticData: { shellLayout: "secondary" },
  component: SettingsLayout,
});

const headers: Record<string, [string, string]> = {
  "/settings": ["Settings", "Organization, connection, and dashboard preferences."],
  "/settings/webhooks": ["Webhooks", "Deliver signed Dotbase events to your systems."],
  "/settings/integrations": [
    "Integrations",
    "Connect Dotbase to deployment and automation platforms.",
  ],
};

function SettingsLayout() {
  const path = useMatches().at(-1)?.pathname ?? "/settings";
  const [title, description] = headers[path] ?? headers["/settings"]!;
  return (
    <div className="grid h-full min-w-0 grid-cols-[216px_minmax(0,1fr)] max-md:h-auto max-md:grid-cols-1">
      <SettingsSidebar />
      <ScrollArea className="grid h-full min-w-0 content-start gap-5 p-5 max-lg:h-auto max-lg:overflow-visible max-sm:p-3 xl:p-6">
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
