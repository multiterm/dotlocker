import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Skeleton } from "@dotlocker/ui";
import { AppRoute } from "./app";
import { Dialog } from "~webui/components/Dialog";
import { useSession } from "~webui/lib/session";
import { errorMessage } from "~webui/lib/errors";
import type { FileRecord } from "~webui/lib/api";

export const FilesRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/files",
  component: FilesPage,
});

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function FilesPage() {
  const { api, org } = useSession();
  const [repoFilter, setRepoFilter] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState("");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"upload" | "delete" | "editor" | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [editorText, setEditorText] = useState("");
  const [editorOriginal, setEditorOriginal] = useState("");
  const [uploadRepo, setUploadRepo] = useState("portal");
  const [uploadRuntime, setUploadRuntime] = useState("preview");
  const [remotePath, setRemotePath] = useState("");
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.files(org);
      setFiles(response.files);
    } catch (reason) {
      setError(`Could not load files. ${errorMessage(reason)}`);
    } finally {
      setLoading(false);
    }
  }, [api, org]);

  useEffect(() => {
    void load();
  }, [load]);

  const repos = useMemo(() => [...new Set(files.map((file) => file.repo))].sort(), [files]);
  const runtimes = useMemo(
    () =>
      [
        ...new Set(
          files
            .filter((file) => !repoFilter || file.repo === repoFilter)
            .map((file) => file.runtime),
        ),
      ].sort(),
    [files, repoFilter],
  );
  const visibleFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return files.filter(
      (file) =>
        (!repoFilter || file.repo === repoFilter) &&
        (!runtimeFilter || file.runtime === runtimeFilter) &&
        (!normalizedQuery ||
          `${file.repo}/${file.runtime}/${file.relPath}`.toLowerCase().includes(normalizedQuery)),
    );
  }, [files, query, repoFilter, runtimeFilter]);

  const openUpload = () => {
    setLocalFiles([]);
    setUploadProgress(0);
    setRemotePath("");
    setError("");
    setModal("upload");
  };

  const submitUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!localFiles.length || !uploadRepo.trim() || !uploadRuntime.trim()) return;
    setSubmitting(true);
    setUploadProgress(0);
    try {
      for (const [index, file] of localFiles.entries()) {
        const target = localFiles.length === 1 && remotePath.trim() ? remotePath.trim() : file.name;
        await api.upload([org, uploadRepo.trim(), uploadRuntime.trim(), target].join("/"), file);
        setUploadProgress(Math.round(((index + 1) / localFiles.length) * 100));
      }
      await load();
      setModal(null);
    } catch (reason) {
      setError(`Could not upload files. ${errorMessage(reason)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!selectedFile) return;
    setSubmitting(true);
    try {
      await api.deleteFile(selectedFile.path);
      await load();
      setModal(null);
      setSelectedFile(null);
    } catch (reason) {
      setError(`Could not delete file. ${errorMessage(reason)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const download = async (file: FileRecord) => {
    try {
      const href = URL.createObjectURL(await api.download(file.path));
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = file.relPath.split("/").at(-1) ?? "download";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (reason) {
      setError(`Could not download file. ${errorMessage(reason)}`);
    }
  };

  const openEditor = async (file: FileRecord) => {
    setError("");
    setSelectedFile(file);
    try {
      const text = await api.text(file.path);
      if (text.includes("\u0000"))
        throw new Error("Binary files can be downloaded but not edited in the browser.");
      setEditorText(text);
      setEditorOriginal(text);
      setModal("editor");
    } catch (reason) {
      setError(`Could not open file. ${errorMessage(reason)}`);
    }
  };

  const saveEditor = async () => {
    if (!selectedFile) return;
    setSubmitting(true);
    try {
      await api.upload(
        selectedFile.path,
        new Blob([editorText], { type: "text/plain;charset=utf-8" }),
      );
      await load();
      setModal(null);
    } catch (reason) {
      setError(`Could not save file. ${errorMessage(reason)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section className="card p-0">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pl-line)] px-5 py-4">
          <div>
            <h3 className="mb-0">Managed files</h3>
            <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">
              {loading
                ? "Loading files…"
                : `${visibleFiles.length} of ${files.length} files in ${org}`}
            </p>
          </div>
          <button onClick={openUpload} aria-label="Add file">
            <span className="text-lg leading-none" aria-hidden>
              +
            </span>{" "}
            Add file
          </button>
        </header>

        <div className="grid grid-cols-1 gap-3 border-b border-[var(--pl-line)] bg-[var(--pl-surface)] px-5 py-4 md:grid-cols-[minmax(240px,1fr)_200px_200px]">
          <label className="relative mt-0 block">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--pl-subtle)]">
              <SearchIcon />
            </span>
            <input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files by path…"
              aria-label="Search files"
            />
          </label>
          <label className="mt-0 block">
            <span className="sr-only">Repository</span>
            <select
              value={repoFilter}
              onChange={(event) => {
                setRepoFilter(event.target.value);
                setRuntimeFilter("");
              }}
              aria-label="Filter by repository"
            >
              <option value="">All repositories</option>
              {repos.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-0 block">
            <span className="sr-only">Runtime</span>
            <select
              value={runtimeFilter}
              onChange={(event) => setRuntimeFilter(event.target.value)}
              aria-label="Filter by runtime"
            >
              <option value="">All runtimes</option>
              {runtimes.map((runtime) => (
                <option key={runtime} value={runtime}>
                  {runtime}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-[var(--pl-radius-xs)] border border-[var(--pl-danger)]/40 bg-[var(--pl-danger)]/5 px-3 py-2 text-xs text-[var(--pl-danger)]">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="mt-0 min-w-[820px] rounded-none border-0">
            <thead>
              <tr>
                <th>Name</th>
                <th>Repository</th>
                <th>Runtime</th>
                <th>Size</th>
                <th>Modified</th>
                <th className="w-20 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }, (_, index) => (
                  <tr key={`file-skeleton-${index}`}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 shrink-0" />
                        <div className="grid gap-2">
                          <Skeleton className="h-3.5 w-48" />
                          <Skeleton className="h-2.5 w-24" />
                        </div>
                      </div>
                    </td>
                    <td>
                      <Skeleton className="h-3.5 w-24" />
                    </td>
                    <td>
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </td>
                    <td>
                      <Skeleton className="h-3.5 w-14" />
                    </td>
                    <td>
                      <Skeleton className="h-3.5 w-32" />
                    </td>
                    <td>
                      <Skeleton className="ml-auto h-8 w-16" />
                    </td>
                  </tr>
                ))
              ) : visibleFiles.length ? (
                visibleFiles.map((file) => (
                  <tr key={file.path}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] text-[var(--pl-muted)]"
                          aria-hidden
                        >
                          ▤
                        </span>
                        <div className="min-w-0">
                          <code className="block max-w-[340px] truncate font-semibold">
                            {file.relPath}
                          </code>
                          <span className="text-[10px] text-[var(--pl-subtle)]">
                            {file.sha256.slice(0, 12)}…
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <b className="text-[var(--pl-text)]">{file.repo}</b>
                    </td>
                    <td>
                      <span className="pill">{file.runtime}</span>
                    </td>
                    <td>{formatBytes(file.size)}</td>
                    <td>{new Date(file.updatedAt).toLocaleString()}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button className="secondary inline" onClick={() => void openEditor(file)}>
                          Edit
                        </button>
                        <button className="secondary inline" onClick={() => void download(file)}>
                          Download
                        </button>
                        <button
                          className="secondary inline"
                          onClick={() => {
                            setSelectedFile(file);
                            setError("");
                            setModal("delete");
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[var(--pl-muted)]">
                    No files match your search and filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "upload" && (
        <Dialog title="Add file" onClose={() => setModal(null)}>
          <form onSubmit={(event) => void submitUpload(event)}>
            <p className="mt-0 text-sm text-[var(--pl-muted)]">
              Upload a file to a repository and runtime in {org}.
            </p>
            <div className="row">
              <div>
                <label htmlFor="upload-repo">Repository</label>
                <input
                  id="upload-repo"
                  required
                  value={uploadRepo}
                  onChange={(event) => setUploadRepo(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="upload-runtime">Runtime</label>
                <input
                  id="upload-runtime"
                  required
                  value={uploadRuntime}
                  onChange={(event) => setUploadRuntime(event.target.value)}
                />
              </div>
            </div>
            <label htmlFor="remote-path">Remote path</label>
            <input
              id="remote-path"
              value={remotePath}
              onChange={(event) => setRemotePath(event.target.value)}
              placeholder="Defaults to the local filename"
            />
            <label htmlFor="local-file">File</label>
            <input
              id="local-file"
              type="file"
              multiple
              required
              onChange={(event) => setLocalFiles(Array.from(event.target.files ?? []))}
            />
            <p className="text-xs text-[var(--pl-muted)]">
              Select multiple files to upload them as a queue. The remote path override applies only
              to a single file.
            </p>
            {submitting && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded bg-[var(--pl-surface-2)]">
                  <div
                    className="h-full bg-[var(--pl-primary)] transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--pl-muted)]">Uploading {uploadProgress}%</p>
              </div>
            )}
            {error && <p className="err mt-3 text-xs">{error}</p>}
            <div className="actions justify-end border-t border-[var(--pl-line)] pt-4">
              <button type="button" className="secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="submit" disabled={!localFiles.length || submitting}>
                {submitting
                  ? "Uploading…"
                  : `Upload ${localFiles.length || ""} file${localFiles.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === "editor" && selectedFile && (
        <Dialog title={`Edit ${selectedFile.relPath}`} onClose={() => setModal(null)}>
          <p className="mt-0 text-xs text-[var(--pl-muted)]">
            <code>
              {selectedFile.repo}/{selectedFile.runtime}
            </code>{" "}
            · {editorText.length} characters ·{" "}
            {editorText === editorOriginal
              ? "No changes"
              : `${Math.abs(editorText.length - editorOriginal.length)} character length change`}
          </p>
          {/(^|[-_.])(prod|production)([-_.]|$)/i.test(selectedFile.runtime) && (
            <div className="mb-3 rounded-[var(--pl-radius-xs)] border border-[var(--pl-warning)]/50 bg-[var(--pl-warning)]/5 p-3 text-xs">
              Production runtime: review the change and create an immutable runtime release after
              saving.
            </div>
          )}
          <textarea
            autoFocus
            spellCheck={false}
            rows={18}
            className="w-full resize-y rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-bg)] p-3 font-mono text-xs text-[var(--pl-text)] outline-none focus:border-[var(--pl-primary)]"
            value={editorText}
            onChange={(event) => setEditorText(event.target.value)}
          />
          {error && <p className="err mt-3 text-xs">{error}</p>}
          <div className="actions justify-end border-t border-[var(--pl-line)] pt-4">
            <button className="secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              disabled={submitting || editorText === editorOriginal}
              onClick={() => void saveEditor()}
            >
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Dialog>
      )}

      {modal === "delete" && selectedFile && (
        <Dialog title="Delete file" onClose={() => setModal(null)}>
          <p className="mt-0 text-sm text-[var(--pl-muted)]">
            Are you sure you want to delete this managed file? This action cannot be undone.
          </p>
          <div className="rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] p-3">
            <code className="text-xs text-[var(--pl-text)]">{selectedFile.path}</code>
          </div>
          {error && <p className="err mt-3 text-xs">{error}</p>}
          <div className="actions justify-end border-t border-[var(--pl-line)] pt-4">
            <button className="secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="danger" disabled={submitting} onClick={() => void confirmDelete()}>
              {submitting ? "Deleting…" : "Delete file"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
