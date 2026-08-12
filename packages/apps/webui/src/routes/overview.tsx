import { createRoute, Link } from "@tanstack/react-router";
import { AppRoute } from "./app";
import { useSession } from "~webui/lib/session";

export const OverviewRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/",
  component: OverviewPage,
});

const action = "inline-flex min-h-9 items-center justify-center rounded-[var(--pl-radius-xs)] border px-3.5 py-2 text-sm font-semibold no-underline transition-colors";

function OverviewPage() {
  const session = useSession();

  const email = session.me?.identityEmail ?? session.me?.token.userEmail ?? "Loading…";
  const grantCount = session.me?.grants.length ?? 0;
  const orgCount = session.me?.orgs.length ?? 0;
  const expiresAt = session.me?.token.expiresAt;

  return (
    <div className="grid gap-5">
      <div className="grid cols-3">
        <section className="card">
          <p className="mb-3 mt-0 text-[10px] font-bold uppercase tracking-[.11em] text-[var(--pl-subtle)]">Active identity</p>
          <div className="truncate text-lg font-semibold tracking-[-.02em] text-[var(--pl-text)]">{email}</div>
          <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">Keyname sign-in identity</p>
        </section>
        <section className="card">
          <p className="mb-3 mt-0 text-[10px] font-bold uppercase tracking-[.11em] text-[var(--pl-subtle)]">Access</p>
          <div className="text-3xl font-semibold tracking-[-.04em] text-[var(--pl-text)]">{grantCount}</div>
          <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">grants across {orgCount} organization{orgCount === 1 ? "" : "s"}</p>
        </section>
        <section className="card">
          <p className="mb-3 mt-0 text-[10px] font-bold uppercase tracking-[.11em] text-[var(--pl-subtle)]">Session</p>
          <div className="flex items-center gap-2 text-lg font-semibold text-[var(--pl-text)]"><span className="h-2 w-2 rounded-full bg-[var(--pl-success)]" /> Active</div>
          <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">{expiresAt ? `Expires ${new Date(expiresAt).toLocaleString()}` : "Managed securely by dot.locker"}</p>
        </section>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h3>Workspace</h3>
          <p className="muted">dot.locker keeps files isolated by organization, repository, and runtime while preserving a complete audit trail.</p>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-[var(--pl-line)] pb-3"><dt className="text-[var(--pl-muted)]">Organization</dt><dd className="m-0 font-semibold text-[var(--pl-text)]">{session.org}</dd></div>
            <div className="flex items-center justify-between gap-4 border-b border-[var(--pl-line)] pb-3"><dt className="text-[var(--pl-muted)]">Identity provider</dt><dd className="m-0 font-semibold text-[var(--pl-text)]">Keyname</dd></div>
            <div className="flex items-center justify-between gap-4"><dt className="text-[var(--pl-muted)]">API connection</dt><dd className="m-0 font-semibold text-[var(--pl-text)]">{session.server || "Same origin"}</dd></div>
          </dl>
        </section>

        <section className="card">
          <h3>Quick actions</h3>
          <p className="muted">Manage runtime files, issue agent credentials, or inspect recent activity.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Link to="/files" className={`${action} border-[var(--pl-primary)] bg-[var(--pl-primary)] text-[var(--pl-bg)]`}>Open files →</Link>
            <Link to="/tokens" className={`${action} border-[var(--pl-line)] bg-[var(--pl-surface)] text-[var(--pl-text)] hover:border-[var(--pl-line-strong)]`}>Create API key</Link>
            <Link to="/repos" className={`${action} border-[var(--pl-line)] bg-[var(--pl-surface)] text-[var(--pl-text)] hover:border-[var(--pl-line-strong)]`}>Configure repo</Link>
            <Link to="/logs" className={`${action} border-[var(--pl-line)] bg-[var(--pl-surface)] text-[var(--pl-text)] hover:border-[var(--pl-line-strong)]`}>View admin logs</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
