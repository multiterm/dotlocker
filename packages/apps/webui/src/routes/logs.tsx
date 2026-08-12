import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Skeleton, Text } from "@multiterm/pluto-ui";
import { AppRoute } from "./app";
import { useSession } from "~webui/lib/session";
import type { AuditEntry } from "~webui/lib/api";

export const LogsRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/logs",
  component: LogsPage,
});

function LogsPage() {
  const { api, org } = useSession();
  const [events, setEvents] = useState<AuditEntry[]>([]);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEvents((await api.audit(org, 500)).audit);
    } catch (reason) {
      setError(`Admin logs require organization-admin access. ${JSON.stringify(reason)}`);
    } finally {
      setLoading(false);
    }
  }, [api, org]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useMemo(() => [...new Set(events.map((event) => event.action))].sort(), [events]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter(
      (event) =>
        (!action || event.action === action) &&
        (!needle ||
          `${event.action} ${event.path} ${event.tokenId ?? ""} ${event.ip ?? ""} ${event.status}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [action, events, query]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(visible, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `dotbase-${org}-logs.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <Card className="p-0">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pl-line)] px-5 py-4">
        <div>
          <Text as="h2" variant="title">
            Organization event stream
          </Text>
          <Text className="mt-1 text-xs text-[var(--pl-muted)]">
            {loading ? "Loading events…" : `${visible.length} of ${events.length} events`}
          </Text>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
          <Button variant="secondary" size="sm" disabled={!visible.length} onClick={exportJson}>
            Export JSON
          </Button>
        </div>
      </header>
      <div className="grid gap-3 border-b border-[var(--pl-line)] bg-[var(--pl-surface)] p-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <Input
          aria-label="Search logs"
          placeholder="Search path, token, IP, or status…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filter by action"
          className="h-11 rounded-md border border-[var(--pl-line)] bg-[var(--pl-bg)] px-3 text-sm"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          <option value="">All events</option>
          {actions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <div className="m-5 rounded-[var(--pl-radius-xs)] border border-[var(--pl-danger)]/40 bg-[var(--pl-danger)]/5 p-3 text-sm text-[var(--pl-danger)]">
          {error}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--pl-line)] bg-[var(--pl-surface)] text-[10px] font-bold uppercase tracking-wider text-[var(--pl-subtle)]">
              <th className="px-5 py-3">Time</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Resource</th>
              <th className="px-4 py-3">Actor token</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 6 }, (_, index) => (
              <tr key={`log-skeleton-${index}`} className="border-b border-[var(--pl-line)] last:border-0">
                <td className="px-5 py-3"><Skeleton className="h-3.5 w-32" /></td>
                <td className="px-4 py-3"><Skeleton className="h-6 w-20 rounded-full" /></td>
                <td className="px-4 py-3"><Skeleton className="h-3.5 w-52" /></td>
                <td className="px-4 py-3"><Skeleton className="h-3.5 w-28" /></td>
                <td className="px-4 py-3"><Skeleton className="h-3.5 w-24" /></td>
                <td className="px-5 py-3"><Skeleton className="h-6 w-14 rounded-full" /></td>
              </tr>
            )) : visible.map((event, index) => (
              <tr
                key={`${event.ts ?? 0}-${event.action}-${event.path}-${index}`}
                className="border-b border-[var(--pl-line)] last:border-0 hover:bg-[var(--pl-surface)]"
              >
                <td className="whitespace-nowrap px-5 py-3 text-xs text-[var(--pl-subtle)]">
                  {event.ts ? new Date(event.ts).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant={
                      event.action === "deny" || event.action === "auth_fail"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {event.action}
                  </Badge>
                </td>
                <td
                  className="max-w-[420px] truncate px-4 py-3 font-mono text-xs"
                  title={event.path}
                >
                  {event.path}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--pl-muted)]">
                  {event.tokenId ?? "anonymous"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--pl-muted)]">
                  {event.ip ?? "—"}
                </td>
                <td className="px-5 py-3">
                  <Badge variant={event.status >= 400 ? "destructive" : "success"}>
                    {event.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && !loading && !error && (
          <div className="py-14 text-center text-sm text-[var(--pl-muted)]">
            No events match these filters.
          </div>
        )}
      </div>
    </Card>
  );
}
