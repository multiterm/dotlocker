import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppRoute } from "./app";
import { useSession } from "~webui/lib/session";
import { errorMessage } from "~webui/lib/errors";
import type { StorageStatus } from "~webui/lib/api";

export const StorageRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/storage",
  component: StoragePage,
});
function bytes(value: number) {
  return value < 1024 ** 2
    ? `${(value / 1024).toFixed(1)} KiB`
    : `${(value / 1024 ** 2).toFixed(1)} MiB`;
}
function StoragePage() {
  const { api, org } = useSession();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await api.storageStatus());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);
  return (
    <div className="grid gap-5">
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3>Storage integrity</h3>
            <p className="muted">
              Compare {org} metadata with the active object backend without exposing object contents
              or credentials.
            </p>
          </div>
          <button className="secondary" onClick={() => void load()}>
            Run check
          </button>
        </div>
        {error && <p className="err">{error}</p>}
        {status && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <p className="text-xs text-[var(--pl-subtle)]">Backend</p>
              <b className="capitalize">{status.backend}</b>
            </div>
            <div>
              <p className="text-xs text-[var(--pl-subtle)]">Bucket</p>
              <code>{status.bucket ?? "Local filesystem"}</code>
            </div>
            <div>
              <p className="text-xs text-[var(--pl-subtle)]">Managed files</p>
              <b>{status.files}</b>
            </div>
            <div>
              <p className="text-xs text-[var(--pl-subtle)]">Logical usage</p>
              <b>{bytes(status.bytes)}</b>
            </div>
          </div>
        )}
        {loading && <p className="muted">Checking storage…</p>}
      </section>
      {status && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="card">
            <h3>Missing objects</h3>
            <p className="muted">Metadata entries whose current file object was not found.</p>
            {status.missing.length ? (
              status.missing.map((path) => (
                <code key={path} className="block py-1">
                  {path}
                </code>
              ))
            ) : (
              <p className="text-[var(--pl-success)]">No missing current objects.</p>
            )}
          </div>
          <div className="card">
            <h3>Orphan candidates</h3>
            <p className="muted">
              Current file objects without active metadata. Review only; this page never deletes
              data.
            </p>
            {status.orphaned.length ? (
              status.orphaned.map((path) => (
                <code key={path} className="block py-1">
                  {path}
                </code>
              ))
            ) : (
              <p className="text-[var(--pl-success)]">No orphan current objects.</p>
            )}
          </div>
        </section>
      )}
      <section className="card">
        <h3>Backup and maintenance</h3>
        <p className="muted">
          On Abby, run <code>pnpm abby:backup</code> before container or PostgreSQL updates. Use{" "}
          <code>pnpm abby:update</code> for health-gated replacement and{" "}
          <code>pnpm abby:status</code> to inspect containers. Garage data and PostgreSQL volumes
          are never pruned by lifecycle scripts.
        </p>
      </section>
    </div>
  );
}
