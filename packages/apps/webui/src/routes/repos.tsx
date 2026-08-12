import { createRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AppRoute } from "./app";
import { Dialog } from "~webui/components/Dialog";
import { useSession } from "~webui/lib/session";
import type { FileRecord } from "~webui/lib/api";

export const ReposRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/repos",
  component: ReposPage,
});

interface RepoSummary {
  name: string;
  files: number;
  bytes: number;
  updatedAt: number;
  runtimes: string[];
}

function formatBytes(value: number): string {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function summarize(files: FileRecord[]): RepoSummary[] {
  const values = new Map<string, RepoSummary>();
  for (const file of files) {
    const current = values.get(file.repo) ?? {
      name: file.repo,
      files: 0,
      bytes: 0,
      updatedAt: 0,
      runtimes: [],
    };
    current.files += 1;
    current.bytes += file.size;
    current.updatedAt = Math.max(current.updatedAt, file.updatedAt);
    if (!current.runtimes.includes(file.runtime)) current.runtimes.push(file.runtime);
    values.set(file.repo, current);
  }
  return [...values.values()]
    .map((item) => ({ ...item, runtimes: item.runtimes.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ReposPage() {
  const { api, org, server } = useSession();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [projectName, setProjectName] = useState("");
  const [runtime, setRuntime] = useState("preview");
  const [targetDir, setTargetDir] = useState(".pluto");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api.files(org)
      .then((response) => setFiles(response.files))
      .catch((reason) => setError(JSON.stringify(reason)))
      .finally(() => setLoading(false));
  }, [api, org]);

  const repositories = useMemo(() => summarize(files), [files]);
  const base = server || "https://pluto.honeycluster.xyz";
  const config = `import { definePlutoConfig } from "@multiterm/pluto/client";\n\nexport default definePlutoConfig({\n  org: "${org}",\n  repo: "${projectName}",\n  runtime: "${runtime}",\n  server: "${base}",\n  targetDir: "${targetDir}",\n});`;

  const openCreateProject = () => {
    setProjectName("");
    setRuntime("preview");
    setTargetDir(".pluto");
    setFormError("");
    setStep(1);
    setOpen(true);
  };

  const createSetup = (event: FormEvent) => {
    event.preventDefault();
    const normalized = projectName.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
      setFormError("Use lowercase letters, numbers, periods, underscores, or hyphens.");
      return;
    }
    if (repositories.some((item) => item.name === normalized)) {
      setFormError("A managed project with this name already exists.");
      return;
    }
    setProjectName(normalized);
    setFormError("");
    setStep(2);
  };

  return (
    <>
      <section className="card p-0">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pl-line)] px-5 py-4">
          <div>
            <h3 className="mb-0">Managed repositories</h3>
            <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">
              {loading ? "Loading repositories…" : `${repositories.length} repositories · ${files.length} files in ${org}`}
            </p>
          </div>
          <button onClick={openCreateProject} aria-label="Create project">
            <span className="text-lg leading-none" aria-hidden>+</span> Create project
          </button>
        </header>

        {error && <div className="mx-5 mt-4 rounded-[var(--pl-radius-xs)] border border-[var(--pl-danger)]/40 bg-[var(--pl-danger)]/5 px-3 py-2 text-xs text-[var(--pl-danger)]">{error}</div>}

        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {repositories.map((item) => (
            <article key={item.name} className="rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] p-4 transition-colors hover:border-[var(--pl-line-strong)]">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-elevated)] font-mono text-sm font-bold text-[var(--pl-primary)]" aria-hidden>◇</span>
                <div className="min-w-0 flex-1">
                  <h4 className="m-0 truncate text-sm font-semibold text-[var(--pl-text)]">{item.name}</h4>
                  <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">{item.files} files · {formatBytes(item.bytes)}</p>
                </div>
              </div>
              <div className="mt-4 flex min-h-7 flex-wrap gap-1.5">
                {item.runtimes.map((name) => <span key={name} className="pill">{name}</span>)}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--pl-line)] pt-3">
                <span className="text-[10px] text-[var(--pl-subtle)]">Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
                <Link to="/files" className="text-xs font-semibold text-[var(--pl-primary)] no-underline hover:underline">View files →</Link>
              </div>
            </article>
          ))}
          {!loading && !repositories.length && (
            <div className="col-span-full py-12 text-center">
              <p className="m-0 text-sm font-semibold text-[var(--pl-text)]">No managed repositories</p>
              <p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">Create a project to get setup instructions.</p>
            </div>
          )}
        </div>
      </section>

      {open && (
        <Dialog title={step === 1 ? "Create project" : `Set up ${projectName}`} onClose={() => setOpen(false)}>
          {step === 1 ? (
            <form onSubmit={createSetup}>
              <p className="mt-0 text-sm text-[var(--pl-muted)]">Define the initial repository and runtime. Dotbase will generate the setup steps for your project.</p>
              <label htmlFor="project-name">Project name</label>
              <input id="project-name" autoFocus required value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="my-project" autoComplete="off" />
              <div className="row">
                <div>
                  <label htmlFor="project-runtime">Initial runtime</label>
                  <select id="project-runtime" value={runtime} onChange={(event) => setRuntime(event.target.value)}>
                    <option value="default">default</option>
                    <option value="dev">dev</option>
                    <option value="preview">preview</option>
                    <option value="prod">prod</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="project-directory">Local target directory</label>
                  <input id="project-directory" required value={targetDir} onChange={(event) => setTargetDir(event.target.value)} placeholder=".pluto" />
                </div>
              </div>
              {formError && <p className="err mt-3 text-xs">{formError}</p>}
              <div className="actions justify-end border-t border-[var(--pl-line)] pt-4">
                <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit">Continue to setup</button>
              </div>
            </form>
          ) : (
            <div>
              <p className="mt-0 text-sm text-[var(--pl-muted)]">Complete these steps in your project. It will appear as managed after its first successful sync.</p>
              <ol className="m-0 grid list-none gap-4 p-0">
                <li className="grid grid-cols-[28px_1fr] gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--pl-primary)] text-xs font-bold text-[var(--pl-bg)]">1</span><div><b className="text-sm">Install Dotbase</b><pre className="copybox mt-2">pnpm add @multiterm/pluto</pre></div></li>
                <li className="grid grid-cols-[28px_1fr] gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--pl-primary)] text-xs font-bold text-[var(--pl-bg)]">2</span><div><b className="text-sm">Create config/pluto.config.ts</b><pre className="copybox mt-2">{config}</pre></div></li>
                <li className="grid grid-cols-[28px_1fr] gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--pl-primary)] text-xs font-bold text-[var(--pl-bg)]">3</span><div><b className="text-sm">Create a scoped API key</b><p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">Create a write API key for <code>{org}/{projectName}/{runtime}/**</code> from the API Keys page. This is the only authentication credential required locally.</p></div></li>
                <li className="grid grid-cols-[28px_1fr] gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--pl-primary)] text-xs font-bold text-[var(--pl-bg)]">4</span><div><b className="text-sm">Run the first sync</b><pre className="copybox mt-2">PLUTO_TOKEN=&lt;api-key&gt; pnpm exec pluto sync --config config/pluto.config.ts</pre></div></li>
              </ol>
              <div className="actions justify-end border-t border-[var(--pl-line)] pt-4">
                <button className="secondary" onClick={() => setStep(1)}>Back</button>
                <button onClick={() => setOpen(false)}>Done</button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
