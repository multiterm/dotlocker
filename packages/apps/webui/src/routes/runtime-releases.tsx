import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppRoute } from "./app";
import { Dialog } from "~webui/components/Dialog";
import { useSession } from "~webui/lib/session";
import { errorMessage } from "~webui/lib/errors";
import type { FileRecord, RuntimeVersion } from "~webui/lib/api";

export const RuntimeReleasesRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/releases",
  component: RuntimeReleasesPage,
});

type Change = { path: string; kind: "added" | "changed" | "removed" };
function compare(left?: RuntimeVersion, right?: RuntimeVersion): Change[] {
  if (!left || !right) return [];
  const a = new Map(left.files.map((file) => [file.path, file]));
  const b = new Map(right.files.map((file) => [file.path, file]));
  const changes: Change[] = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const before = a.get(path),
      after = b.get(path);
    if (!before) changes.push({ path, kind: "added" });
    else if (!after) changes.push({ path, kind: "removed" });
    else if (before.sha256 !== after.sha256 || before.size !== after.size)
      changes.push({ path, kind: "changed" });
  }
  return changes;
}

function RuntimeReleasesPage() {
  const { api, org } = useSession();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [repo, setRepo] = useState("");
  const [runtime, setRuntime] = useState("");
  const [versions, setVersions] = useState<RuntimeVersion[]>([]);
  const [leftHash, setLeftHash] = useState("");
  const [rightHash, setRightHash] = useState("");
  const [restore, setRestore] = useState<RuntimeVersion | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const repos = useMemo(() => [...new Set(files.map((file) => file.repo))].sort(), [files]);
  const runtimes = useMemo(
    () =>
      [
        ...new Set(files.filter((file) => !repo || file.repo === repo).map((file) => file.runtime)),
      ].sort(),
    [files, repo],
  );
  const left = versions.find((version) => version.hash === leftHash);
  const right = versions.find((version) => version.hash === rightHash);
  const changes = compare(left, right);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = (await api.files(org)).files;
      setFiles(next);
      setRepo((value) => value || next[0]?.repo || "");
      setRuntime((value) => value || next[0]?.runtime || "");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [api, org]);
  const loadVersions = useCallback(async () => {
    if (!repo || !runtime) {
      setVersions([]);
      return;
    }
    try {
      const next = (await api.runtimeVersions(org, repo, runtime)).versions;
      setVersions(next);
      setRightHash(next[0]?.hash ?? "");
      setLeftHash(next[1]?.hash ?? next[0]?.hash ?? "");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [api, org, repo, runtime]);
  useEffect(() => void loadFiles(), [loadFiles]);
  useEffect(() => void loadVersions(), [loadVersions]);

  const currentFiles = files.filter((file) => file.repo === repo && file.runtime === runtime);
  const commit = async (manifest: RuntimeVersion["files"]) => {
    const head = (await api.runtimeHead(org, repo, runtime)).version;
    await api.commitRuntime(org, repo, runtime, [...manifest], head?.hash);
    await Promise.all([loadFiles(), loadVersions()]);
  };
  const createSnapshot = async () => {
    setSubmitting(true);
    setError("");
    try {
      await commit(
        currentFiles.map((file) => ({ path: file.relPath, sha256: file.sha256, size: file.size })),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };
  const confirmRestore = async () => {
    if (!restore) return;
    setSubmitting(true);
    setError("");
    try {
      await commit(restore.files);
      setRestore(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section className="card p-0">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pl-line)] px-5 py-4">
          <div>
            <h3 className="mb-0">Runtime releases</h3>
            <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">
              Immutable snapshots for review, deployment, and rollback. Restore always creates a new
              head.
            </p>
          </div>
          <button
            disabled={!currentFiles.length || submitting}
            onClick={() => void createSnapshot()}
          >
            {submitting ? "Creating…" : "Create snapshot"}
          </button>
        </header>
        <div className="grid gap-3 border-b border-[var(--pl-line)] bg-[var(--pl-surface)] p-4 sm:grid-cols-2">
          <select
            value={repo}
            onChange={(event) => {
              setRepo(event.target.value);
              setRuntime("");
            }}
          >
            <option value="">Select repository</option>
            {repos.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select value={runtime} onChange={(event) => setRuntime(event.target.value)}>
            <option value="">Select runtime</option>
            {runtimes.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        {error && <p className="mx-5 err">{error}</p>}
        <div className="overflow-x-auto">
          <table className="mt-0 min-w-[880px] rounded-none border-0">
            <thead>
              <tr>
                <th>Version</th>
                <th>Files</th>
                <th>Created by</th>
                <th>Created</th>
                <th>Parent</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version, index) => (
                <tr key={version.hash}>
                  <td>
                    <code>{version.shortHash}</code>
                    {index === 0 && <span className="pill ml-2">Head</span>}
                  </td>
                  <td>{version.files.length}</td>
                  <td>{version.createdBy ?? "system"}</td>
                  <td>{new Date(version.createdAt).toLocaleString()}</td>
                  <td>
                    <code>{version.parentHash?.slice(0, 12) ?? "—"}</code>
                  </td>
                  <td>
                    <button
                      className="secondary inline"
                      disabled={index === 0}
                      onClick={() => setRestore(version)}
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
              {!versions.length && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[var(--pl-muted)]">
                    {loading ? "Loading…" : "No immutable snapshots yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {versions.length > 1 && (
        <section className="card">
          <h3>Compare snapshots</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              aria-label="Earlier snapshot"
              value={leftHash}
              onChange={(event) => setLeftHash(event.target.value)}
            >
              {versions.map((version) => (
                <option key={version.hash} value={version.hash}>
                  {version.shortHash} · {new Date(version.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
            <select
              aria-label="Later snapshot"
              value={rightHash}
              onChange={(event) => setRightHash(event.target.value)}
            >
              {versions.map((version) => (
                <option key={version.hash} value={version.hash}>
                  {version.shortHash} · {new Date(version.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-4 grid gap-2">
            {changes.map((change) => (
              <div
                key={change.path}
                className="flex items-center gap-3 rounded border border-[var(--pl-line)] px-3 py-2 text-sm"
              >
                <span className="pill capitalize">{change.kind}</span>
                <code>{change.path}</code>
              </div>
            ))}
            {!changes.length && (
              <p className="muted">These snapshots contain the same file hashes and sizes.</p>
            )}
          </div>
        </section>
      )}
      {restore && (
        <Dialog title={`Restore ${restore.shortHash}`} onClose={() => setRestore(null)}>
          <p className="mt-0 text-sm text-[var(--pl-muted)]">
            Restore {restore.files.length} files to{" "}
            <code>
              {repo}/{runtime}
            </code>
            ? Files absent from this snapshot will be removed. The historical snapshot remains
            immutable and a new head will record this restore.
          </p>
          {/(^|[-_.])(prod|production)([-_.]|$)/i.test(runtime) && (
            <div className="rounded border border-[var(--pl-warning)]/50 p-3 text-sm">
              Production runtime: verify the comparison and deployment candidate before continuing.
            </div>
          )}
          <div className="actions justify-end border-t border-[var(--pl-line)] pt-4">
            <button className="secondary" onClick={() => setRestore(null)}>
              Cancel
            </button>
            <button className="danger" disabled={submitting} onClick={() => void confirmRestore()}>
              {submitting ? "Restoring…" : "Create restored head"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
