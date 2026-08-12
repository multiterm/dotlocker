import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Card, Input, Label, Separator, Text } from "@dotlocker/ui";
import { SettingsLayoutRoute } from "./settings-layout";
import { Dialog } from "~webui/components/Dialog";
import { useSession } from "~webui/lib/session";
import type { WebhookDelivery, WebhookRecord } from "~webui/lib/api";

export const WebhooksRoute = createRoute({
  getParentRoute: () => SettingsLayoutRoute,
  path: "/settings/webhooks",
  component: WebhooksPage,
});

const eventOptions = [
  ["*", "All dot.locker events"],
  ["version", "Runtime versions"],
  ["put", "File uploads"],
  ["delete", "File deletions"],
  ["deny", "Policy denials"],
  ["auth_fail", "Authentication failures"],
  ["warning", "Source warnings"],
  ["token", "API-key lifecycle"],
  ["grant", "Access grants"],
] as const;

function WebhooksPage() {
  const { api } = useSession();
  const [webhooks, setWebhooks] = useState<WebhookRecord[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDelivery[]>>({});
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["version"]);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setWebhooks((await api.webhooks()).webhooks);
      setError("");
    } catch (reason) {
      setError(`Webhooks are available to organization administrators. ${JSON.stringify(reason)}`);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.createWebhook({ name, url, events });
      setSecret(result.secret);
      setName("");
      setUrl("");
      setEvents(["version"]);
      await load();
    } catch (reason) {
      setError(`Could not create webhook: ${JSON.stringify(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleEvent = (event: string) => {
    setEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    );
  };

  const showDeliveries = async (webhook: WebhookRecord) => {
    const result = await api.webhookDeliveries(webhook.id);
    setDeliveries((current) => ({ ...current, [webhook.id]: result.deliveries }));
  };

  return (
    <div className="grid gap-5">
      <Card>
        <Text as="h2" variant="title">
          Add endpoint
        </Text>
        <Text className="mt-1 max-w-2xl text-[var(--pl-muted)]">
          dot.locker signs each JSON payload with HMAC-SHA256. Production endpoints must use HTTPS.
        </Text>
        <Separator className="my-5" />
        <form onSubmit={(event) => void create(event)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="webhook-name">Name</Label>
              <Input
                id="webhook-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Deployment automation"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                id="webhook-url"
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/hooks/dotlocker"
              />
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-semibold">Events</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {eventOptions.map(([value, label]) => (
                <label
                  key={value}
                  className="flex items-center gap-2 rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={events.includes(value)}
                    onChange={() => toggleEvent(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <Text className="text-[var(--pl-danger)]">{error}</Text>}
          <div>
            <Button type="submit" disabled={busy || events.length === 0}>
              {busy ? "Creating…" : "Add webhook"}
            </Button>
          </div>
        </form>
      </Card>

      <div className="grid gap-3">
        {webhooks.map((webhook) => (
          <Card key={webhook.id} density="compact">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Text className="font-semibold">{webhook.name}</Text>
                  <Badge variant={webhook.enabled ? "success" : "secondary"}>
                    {webhook.enabled ? "Active" : "Paused"}
                  </Badge>
                  {webhook.lastStatus && (
                    <Badge variant={webhook.lastStatus < 300 ? "success" : "destructive"}>
                      HTTP {webhook.lastStatus}
                    </Badge>
                  )}
                </div>
                <Text className="mt-1 break-all font-mono text-xs text-[var(--pl-muted)]">
                  {webhook.url}
                </Text>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {webhook.events.map((event) => (
                    <Badge key={event} variant="secondary">
                      {event}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => void showDeliveries(webhook)}>
                  Deliveries
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void api.updateWebhook(webhook.id, { enabled: !webhook.enabled }).then(load)
                  }
                >
                  {webhook.enabled ? "Pause" : "Enable"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm(`Delete ${webhook.name}?`))
                      void api.deleteWebhook(webhook.id).then(load);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            {deliveries[webhook.id] && (
              <div className="mt-4 overflow-x-auto rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)]">
                <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--pl-line)] bg-[var(--pl-surface)]">
                      <th className="p-3">Event</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Response</th>
                      <th className="p-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries[webhook.id]!.map((delivery) => (
                      <tr
                        key={delivery.id}
                        className="border-b border-[var(--pl-line)] last:border-0"
                      >
                        <td className="p-3 font-mono">{delivery.event}</td>
                        <td className="p-3">{delivery.status}</td>
                        <td className="p-3">{delivery.responseStatus ?? delivery.error ?? "—"}</td>
                        <td className="p-3">{new Date(delivery.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
        {!webhooks.length && !error && (
          <Card className="py-12 text-center">
            <Text className="font-semibold">No webhook endpoints yet</Text>
            <Text className="mt-1 text-[var(--pl-muted)]">
              Add an endpoint to automate on dot.locker events.
            </Text>
          </Card>
        )}
      </div>

      {secret && (
        <Dialog title="Save your signing secret" onClose={() => setSecret("")}>
          <div className="rounded-[var(--pl-radius-xs)] border border-[var(--pl-warning)]/40 bg-[var(--pl-warning)]/10 p-3 text-sm">
            This secret is shown once. Store it in your secret manager.
          </div>
          <label htmlFor="webhook-secret">Signing secret</label>
          <textarea
            id="webhook-secret"
            readOnly
            rows={3}
            className="w-full resize-none rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-bg)] p-3 font-mono text-xs"
            value={secret}
          />
          <div className="actions justify-end">
            <button
              className="secondary"
              onClick={() => void navigator.clipboard.writeText(secret)}
            >
              Copy
            </button>
            <button onClick={() => setSecret("")}>Done</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
