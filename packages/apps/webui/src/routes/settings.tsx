import { createRoute } from "@tanstack/react-router";
import { Card, Separator, Text } from "@dotlocker/ui";
import { ModeToggle, ThemeVariantSelect } from "@dotlocker/ui-shared";
import { SettingsLayoutRoute } from "./settings-layout";
import { useSession } from "~webui/lib/session";

export const SettingsRoute = createRoute({
  getParentRoute: () => SettingsLayoutRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
  const { me, org, server } = useSession();
  return (
    <div className="grid gap-5">
      <Card>
        <Text as="h2" variant="title">
          Organization
        </Text>
        <Text className="mt-1 text-[var(--pl-muted)]">
          The active tenant for repositories, keys, policies, logs, and integrations.
        </Text>
        <Separator className="my-5" />
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Text variant="label" className="text-[var(--pl-subtle)]">
              Organization
            </Text>
            <Text className="mt-1 font-semibold">{org}</Text>
          </div>
          <div>
            <Text variant="label" className="text-[var(--pl-subtle)]">
              API endpoint
            </Text>
            <Text className="mt-1 break-all font-mono text-xs">{server || location.origin}</Text>
          </div>
        </div>
      </Card>

      <Card>
        <Text as="h2" variant="title">
          Appearance
        </Text>
        <Text className="mt-1 text-[var(--pl-muted)]">
          Choose how the dot.locker dashboard looks on this device.
        </Text>
        <Separator className="my-5" />
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <Text className="font-semibold">Theme variant</Text>
            <Text className="mt-1 text-[var(--pl-muted)]">Select a dashboard color palette.</Text>
          </div>
          <ThemeVariantSelect />
        </div>
        <Separator className="my-5" />
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <Text className="font-semibold">Color mode</Text>
            <Text className="mt-1 text-[var(--pl-muted)]">Switch between light and dark mode.</Text>
          </div>
          <ModeToggle />
        </div>
      </Card>

      <Card>
        <Text as="h2" variant="title">
          Session and identity
        </Text>
        <Text className="mt-1 text-[var(--pl-muted)]">
          Authentication, passkeys, MFA, and recovery are managed by Keyname.
        </Text>
        <Separator className="my-5" />
        <div>
          <Text variant="label" className="text-[var(--pl-subtle)]">
            Signed in as
          </Text>
          <Text className="mt-1 font-semibold">
            {me?.identityEmail ?? me?.token.userEmail ?? "Loading…"}
          </Text>
        </div>
      </Card>
    </div>
  );
}
