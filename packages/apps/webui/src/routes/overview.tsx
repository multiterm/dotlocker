import { createRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@dotlocker/ui";
import { AppRoute } from "./app";
import { useSession } from "~webui/lib/session";
import type { AuditEntry } from "~webui/lib/api";

export const OverviewRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/",
  component: OverviewPage,
});
const action =
  "inline-flex min-h-9 items-center justify-center rounded-[var(--pl-radius-xs)] border px-3.5 py-2 text-sm font-semibold no-underline transition-colors";

function ActivityChart({ events }: { events: AuditEntry[] }) {
  const points = useMemo(() => {
    const now = Date.now(),
      day = 86_400_000;
    return Array.from({ length: 14 }, (_, index) => {
      const start = now - (13 - index) * day;
      return {
        label: new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        count: events.filter((event) => event.ts && event.ts >= start && event.ts < start + day)
          .length,
      };
    });
  }, [events]);
  const max = Math.max(1, ...points.map((point) => point.count));
  const polyline = points
    .map((point, index) => `${(index / 13) * 100},${42 - (point.count / max) * 36}`)
    .join(" ");
  return (
    <section className="card overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <h3>Activity trend</h3>
          <p className="muted">Organization events over the last 14 days.</p>
        </div>
        <span className="pill">{events.length} events</span>
      </div>
      <div className="mt-5 h-44">
        <svg
          viewBox="0 0 100 48"
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          aria-label="14 day activity chart"
        >
          <defs>
            <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--pl-primary)" stopOpacity=".3" />
              <stop offset="1" stopColor="var(--pl-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`M ${polyline} L 100 46 L 0 46 Z`}
            fill="url(#activity-fill)"
            className="pl-chart-enter"
          />
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--pl-primary)"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
            className="pl-chart-line"
          />
          {points.map((point, index) => (
            <circle
              key={point.label}
              cx={(index / 13) * 100}
              cy={42 - (point.count / max) * 36}
              r="1"
              fill="var(--pl-primary)"
            >
              <title>
                {point.label}: {point.count}
              </title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="flex justify-between text-[10px] text-[var(--pl-subtle)]">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </section>
  );
}

function OverviewPage() {
  const session = useSession();
  const email = session.me?.identityEmail ?? session.me?.token.userEmail ?? "Loading…";
  const grantCount = session.me?.grants.length ?? 0,
    orgCount = session.me?.orgs.length ?? 0,
    expiresAt = session.me?.token.expiresAt;
  const [metrics, setMetrics] = useState({ files: 0, storage: 0, keys: 0, events: 0 });
  const [events, setEvents] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    void Promise.allSettled([
      session.api.files(session.org),
      session.api.tokens(),
      session.api.audit(session.org, 500),
    ])
      .then(([fileResult, keyResult, auditResult]) => {
        const files = fileResult.status === "fulfilled" ? fileResult.value.files : [];
        const audit = auditResult.status === "fulfilled" ? auditResult.value.audit : [];
        setEvents(audit);
        setMetrics({
          files: files.length,
          storage: files.reduce((total, file) => total + file.size, 0),
          keys:
            keyResult.status === "fulfilled"
              ? keyResult.value.tokens.filter((key) => !key.revokedAt).length
              : 0,
          events: audit.length,
        });
      })
      .finally(() => setLoading(false));
  }, [session.api, session.org]);
  return (
    <div className="grid gap-5">
      <div className="grid cols-3">
        <section className="card">
          <p className="mb-3 mt-0 text-[10px] font-bold uppercase tracking-[.11em] text-[var(--pl-subtle)]">
            Active identity
          </p>
          <div className="truncate text-lg font-semibold">{email}</div>
          <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">Keyname sign-in identity</p>
        </section>
        <section className="card">
          <p className="mb-3 mt-0 text-[10px] font-bold uppercase tracking-[.11em] text-[var(--pl-subtle)]">
            Access
          </p>
          <div className="text-3xl font-semibold">{grantCount}</div>
          <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">
            grants across {orgCount} organization{orgCount === 1 ? "" : "s"}
          </p>
        </section>
        <section className="card">
          <p className="mb-3 mt-0 text-[10px] font-bold uppercase tracking-[.11em] text-[var(--pl-subtle)]">
            Session
          </p>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="h-2 w-2 rounded-full bg-[var(--pl-success)] pl-pulse" /> Active
          </div>
          <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">
            {expiresAt
              ? `Expires ${new Date(expiresAt).toLocaleString()}`
              : "Managed securely by dot.locker"}
          </p>
        </section>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Managed files", metrics.files],
          ["Stored bytes", metrics.storage.toLocaleString()],
          ["Active API keys", metrics.keys],
          ["Recent events", metrics.events],
        ].map(([label, value], index) => (
          <section
            key={label}
            className="card pl-card-enter"
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <p className="mb-2 mt-0 text-[10px] font-bold uppercase text-[var(--pl-subtle)]">
              {label}
            </p>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-semibold">{value}</div>
            )}
          </section>
        ))}
      </div>
      {loading ? (
        <Skeleton className="h-64 rounded-[var(--pl-radius-sm)]" />
      ) : (
        <ActivityChart events={events} />
      )}
      <div className="grid cols-2">
        <section className="card">
          <h3>Workspace</h3>
          <p className="muted">
            Dotlocker isolates files by organization, repository, and runtime while preserving an
            audit trail.
          </p>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex justify-between border-b border-[var(--pl-line)] pb-3">
              <dt className="text-[var(--pl-muted)]">Organization</dt>
              <dd className="m-0 font-semibold">{session.org}</dd>
            </div>
            <div className="flex justify-between border-b border-[var(--pl-line)] pb-3">
              <dt className="text-[var(--pl-muted)]">Identity provider</dt>
              <dd className="m-0 font-semibold">Keyname</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--pl-muted)]">API connection</dt>
              <dd className="m-0 font-semibold">{session.server || "Same origin"}</dd>
            </div>
          </dl>
        </section>
        <section className="card">
          <h3>Quick actions</h3>
          <p className="muted">Manage runtime files, credentials, releases, or activity.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Link
              to="/files"
              className={`${action} border-[var(--pl-primary)] bg-[var(--pl-primary)] text-[var(--pl-bg)]`}
            >
              Open files →
            </Link>
            <Link
              to="/tokens"
              className={`${action} border-[var(--pl-line)] bg-[var(--pl-surface)] text-[var(--pl-text)]`}
            >
              Create API key
            </Link>
            <Link
              to="/releases"
              className={`${action} border-[var(--pl-line)] bg-[var(--pl-surface)] text-[var(--pl-text)]`}
            >
              Runtime releases
            </Link>
            <Link
              to="/logs"
              className={`${action} border-[var(--pl-line)] bg-[var(--pl-surface)] text-[var(--pl-text)]`}
            >
              View admin logs
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
