import { createRoute } from "@tanstack/react-router";
import { Badge, Button, Card, Text } from "@dotlocker/ui";
import { SettingsLayoutRoute } from "./settings-layout";

export const IntegrationsRoute = createRoute({
  getParentRoute: () => SettingsLayoutRoute,
  path: "/settings/integrations",
  component: IntegrationsPage,
});

const integrations: ReadonlyArray<{
  name: string;
  description: string;
  status: "Available" | "Guide" | "Planned";
  action: string;
  href?: string;
}> = [
  {
    name: "Webhooks",
    description: "Send signed runtime, policy, and file events to any HTTPS endpoint.",
    status: "Available",
    action: "Configure",
    href: "/settings/webhooks",
  },
  {
    name: "GitHub Actions",
    description:
      "Push and promote runtime versions from GitHub workflows using short-lived credentials.",
    status: "Guide",
    action: "View setup",
    href: "https://github.com/multiterm/dotlocker",
  },
  {
    name: "Kubernetes",
    description: "Resolve immutable dot.locker versions into Secrets or mounted runtime files.",
    status: "Planned",
    action: "Coming soon",
  },
  {
    name: "Terraform",
    description: "Manage repositories, runtime policies, API keys, and webhook endpoints as code.",
    status: "Planned",
    action: "Coming soon",
  },
  {
    name: "Docker",
    description: "Pull a pinned runtime version before starting a container workload.",
    status: "Guide",
    action: "View setup",
    href: "https://github.com/multiterm/dotlocker",
  },
  {
    name: "MCP server",
    description: "Allow approved AI tools to inspect versions and operational metadata.",
    status: "Planned",
    action: "Coming soon",
  },
];

function IntegrationsPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {integrations.map((integration) => (
        <Card key={integration.name} className="flex min-h-56 flex-col" density="compact">
          <div className="flex items-start justify-between gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] text-lg text-[var(--pl-primary)]">
              ◇
            </div>
            <Badge variant={integration.status === "Available" ? "success" : "secondary"}>
              {integration.status}
            </Badge>
          </div>
          <Text as="h2" variant="title" className="mt-5">
            {integration.name}
          </Text>
          <Text className="mt-2 flex-1 text-[var(--pl-muted)]">{integration.description}</Text>
          {integration.href ? (
            <a
              href={integration.href}
              className="mt-5 inline-flex h-9 items-center justify-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] px-3 text-sm font-semibold text-[var(--pl-text)] no-underline hover:bg-[var(--pl-surface-2)]"
            >
              {integration.action}
            </a>
          ) : (
            <Button className="mt-5" variant="secondary" disabled>
              {integration.action}
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}
