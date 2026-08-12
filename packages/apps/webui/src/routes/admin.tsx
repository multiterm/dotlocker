import { createRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppRoute } from "./app";
import { useSession } from "~webui/lib/session";
import { Dialog } from "~webui/components/Dialog";
import type { ApiKeyRecord } from "~webui/lib/api";

function Json({ value }: { value: unknown }) {
  return (
    <pre className="muted">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export const UsersRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/users",
  component: UsersPage,
});
function UsersPage() {
  const { api, org } = useSession();
  const [out, setOut] = useState<unknown>(
    "Provision an email, then grant access. The user signs in through Keyname.",
  );
  const [modal, setModal] = useState<"create" | null>(null);
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      setOut(await api.createUser({ org, ...value }));
      setModal(null);
    },
  });
  return (
    <>
      <div className="card">
        <h3>User administration</h3>
        <p className="muted">
          Provision users by their verified Keyname email, then assign repo/runtime grants.
          Credentials, MFA, passkeys, and recovery remain on keyname.dev.
        </p>
        <div className="actions">
          <button onClick={() => setModal("create")}>Provision user</button>
        </div>
        <Json value={out} />
      </div>
      {modal && (
        <Dialog title="Provision Keyname user" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit().catch(setOut);
            }}
          >
            <form.Field name="email">
              {(f) => (
                <>
                  <label>Email</label>
                  <input value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
                </>
              )}
            </form.Field>
            <p className="muted text-sm">The email must match a verified Keyname identity. No dot.locker password is created.</p>
            <button>Provision user</button>
          </form>
        </Dialog>
      )}
    </>
  );
}

export const TokensRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/tokens",
  component: TokensPage,
});
function TokensPage() {
  const { api, org } = useSession();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"create" | "created" | "revoke" | null>(null);
  const [selected, setSelected] = useState<ApiKeyRecord | null>(null);
  const [label, setLabel] = useState("local development");
  const [repo, setRepo] = useState("portal");
  const [runtime, setRuntime] = useState("");
  const [allRepos, setAllRepos] = useState(false);
  const [access, setAccess] = useState<"read" | "write">("write");
  const [expires, setExpires] = useState("2592000");
  const [plaintext, setPlaintext] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setKeys((await api.tokens()).tokens);
    } catch (reason) {
      setError(`Could not load API keys: ${JSON.stringify(reason)}`);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setLabel("local development");
    setRepo("portal");
    setRuntime("");
    setAllRepos(false);
    setAccess("write");
    setExpires("2592000");
    setPlaintext("");
    setCopied(false);
    setError("");
    setModal("create");
  };

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const path = allRepos
        ? `${org}/**`
        : [org, repo.trim(), runtime.trim() || undefined, "**"].filter(Boolean).join("/");
      const result = await api.createToken({
        label: label.trim(),
        scopes: access === "write"
          ? [{ path, access: "read" }, { path, access: "write" }]
          : [{ path, access }],
        ...(expires ? { expiresSeconds: Number(expires) } : {}),
      });
      setPlaintext(result.token);
      await load();
      setModal("created");
    } catch (reason) {
      setError(`Could not create API key: ${JSON.stringify(reason)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const revokeKey = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError("");
    try {
      await api.revokeToken(selected.id);
      await load();
      setModal(null);
      setSelected(null);
    } catch (reason) {
      setError(`Could not revoke API key: ${JSON.stringify(reason)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const statusFor = (key: ApiKeyRecord) => {
    if (key.revokedAt) return "Revoked";
    if (key.expiresAt && key.expiresAt <= Date.now()) return "Expired";
    return "Active";
  };

  return (
    <>
      <section className="card p-0">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pl-line)] px-5 py-4">
          <div><h3 className="mb-0">API keys</h3><p className="mb-0 mt-1 text-xs text-[var(--pl-muted)]">{loading ? "Loading API keys…" : `${keys.length} keys in ${org}`}</p></div>
          <button onClick={openCreate}><span className="text-lg leading-none" aria-hidden>+</span> Create API key</button>
        </header>
        <div className="border-b border-[var(--pl-line)] bg-[var(--pl-surface)] px-5 py-3 text-xs text-[var(--pl-muted)]">Local dot.locker configuration uses an API key as its only authentication credential. Each key grants explicit path and access rights.</div>
        {error && !modal && <div className="mx-5 mt-4 rounded-[var(--pl-radius-xs)] border border-[var(--pl-danger)]/40 bg-[var(--pl-danger)]/5 px-3 py-2 text-xs text-[var(--pl-danger)]">{error}</div>}
        <div className="overflow-x-auto">
          <table className="mt-0 min-w-[880px] rounded-none border-0">
            <thead><tr><th>Name</th><th>Key ID</th><th>Grant scope</th><th>Access rights</th><th>Status</th><th>Created</th><th className="w-20 text-right">Actions</th></tr></thead>
            <tbody>
              {keys.length ? keys.map((key) => {
                const status = statusFor(key);
                return (
                  <tr key={key.id}>
                    <td><b className="text-[var(--pl-text)]">{key.label || "Unnamed key"}</b></td>
                    <td><code>{key.id}</code></td>
                    <td>{key.scopes.map((scope) => <code key={`${scope.path}:${scope.access}`} className="block">{scope.path}</code>)}</td>
                    <td>{key.scopes.map((scope) => <span key={`${scope.path}:${scope.access}`} className="pill capitalize">{scope.access}</span>)}</td>
                    <td><span className={`pill ${status === "Active" ? "text-[var(--pl-success)]" : "text-[var(--pl-subtle)]"}`}>{status}</span></td>
                    <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                    <td className="text-right"><button className="secondary inline" disabled={status === "Revoked"} onClick={() => { setSelected(key); setError(""); setModal("revoke"); }}>Revoke</button></td>
                  </tr>
                );
              }) : <tr><td colSpan={7} className="py-12 text-center text-[var(--pl-muted)]">{loading ? "Loading API keys…" : "No API keys found."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "create" && (
        <Dialog title="Create API key" onClose={() => setModal(null)}>
          <form onSubmit={(event) => void createKey(event)}>
            <p className="mt-0 text-sm text-[var(--pl-muted)]">Create an API key and grant only the access rights required by this local configuration.</p>
            <label htmlFor="key-label">Name</label><input id="key-label" autoFocus required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="local development" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allRepos} onChange={(event) => setAllRepos(event.target.checked)} className="h-4 w-4" /> All repositories and all runtimes</label>
            <div className="row">
              <div><label htmlFor="key-repo">Repository</label><input id="key-repo" required={!allRepos} disabled={allRepos} value={repo} onChange={(event) => setRepo(event.target.value)} /></div>
              <div><label htmlFor="key-runtime">Runtime <span className="font-normal text-[var(--pl-subtle)]">(optional)</span></label><input id="key-runtime" disabled={allRepos} value={runtime} onChange={(event) => setRuntime(event.target.value)} placeholder="All runtimes" /></div>
            </div>
            <div className="row">
              <div><label htmlFor="key-access">Access rights</label><select id="key-access" value={access} onChange={(event) => setAccess(event.target.value as typeof access)}><option value="read">Read only</option><option value="write">Read and write</option></select></div>
              <div><label htmlFor="key-expiry">Expiration</label><select id="key-expiry" value={expires} onChange={(event) => setExpires(event.target.value)}><option value="86400">1 day</option><option value="604800">7 days</option><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="">Never</option></select></div>
            </div>
            <div className="mt-4 rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] p-3 text-xs text-[var(--pl-muted)]">Grant: <code>{allRepos ? `${org}/**` : [org, repo || "<repository>", runtime || undefined, "**"].filter(Boolean).join("/")}</code> · <b className="capitalize text-[var(--pl-text)]">{access === "write" ? "read + write" : "read"}</b></div>
            {error && <p className="err mt-3 text-xs">{error}</p>}
            <div className="actions justify-end border-t border-[var(--pl-line)] pt-4"><button type="button" className="secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create API key"}</button></div>
          </form>
        </Dialog>
      )}

      {modal === "created" && (
        <Dialog title="API key created" onClose={() => setModal(null)}>
          <div className="rounded-[var(--pl-radius-xs)] border border-[var(--pl-success)]/40 bg-[var(--pl-success)]/5 p-3 text-sm text-[var(--pl-muted)]">Copy this API key now. It will not be shown again.</div>
          <label htmlFor="created-key">API key</label><textarea id="created-key" readOnly rows={3} className="w-full resize-none rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-bg)] p-3 font-mono text-xs text-[var(--pl-text)] outline-none" value={plaintext} />
          <p className="text-xs text-[var(--pl-muted)]">Use it locally as <code>DOTLOCKER_TOKEN</code>. No username or password is required.</p>
          <div className="actions justify-end border-t border-[var(--pl-line)] pt-4"><button className="secondary" onClick={() => void navigator.clipboard.writeText(plaintext).then(() => setCopied(true))}>{copied ? "Copied" : "Copy API key"}</button><button onClick={() => setModal(null)}>Done</button></div>
        </Dialog>
      )}

      {modal === "revoke" && selected && (
        <Dialog title="Revoke API key" onClose={() => setModal(null)}>
          <p className="mt-0 text-sm text-[var(--pl-muted)]">Revoke <b className="text-[var(--pl-text)]">{selected.label || selected.id}</b>? Local configurations using this key will immediately lose access.</p>
          {error && <p className="err mt-3 text-xs">{error}</p>}
          <div className="actions justify-end border-t border-[var(--pl-line)] pt-4"><button className="secondary" onClick={() => setModal(null)}>Cancel</button><button className="danger" disabled={submitting} onClick={() => void revokeKey()}>{submitting ? "Revoking…" : "Revoke API key"}</button></div>
        </Dialog>
      )}
    </>
  );
}

export const AuditRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/audit",
  component: AuditPage,
});
function AuditPage() {
  const { api, org } = useSession();
  const [limit, setLimit] = useState(100);
  const [out, setOut] = useState<unknown>("No audit loaded.");
  return (
    <div className="card">
      <h3>Audit events</h3>
      <p className="muted">
        Audit events show authentication, file access, grant, token, and warning activity for this
        organization.
      </p>
      <div className="row">
        <div>
          <label>Limit</label>
          <input value={limit} onChange={(e) => setLimit(Number(e.target.value) || 100)} />
        </div>
        <div>
          <button onClick={() => void api.audit(org, limit).then(setOut).catch(setOut)}>Load audit</button>
        </div>
      </div>
      <Json value={out} />
    </div>
  );
}

export const SettingsRoute = createRoute({
  getParentRoute: () => AppRoute,
  path: "/settings",
  component: SettingsPage,
});
function SettingsPage() {
  const s = useSession();
  const [org, setOrg] = useState(s.org);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const saveOrganization = async () => {
    if (org === s.org) return;
    setSaving(true);
    setError("");
    try {
      const next = await s.api.switchOrg(org);
      s.setMe(next);
      s.setOrg(next.token.org);
    } catch (reason) {
      setError(`Could not switch organization: ${JSON.stringify(reason)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid cols-2">
      <div className="card">
        <h3>Connection</h3>
        <p className="muted">
          dot.locker uses the authenticated same-origin connection. Organizations are limited to your current grants.
        </p>
        <label>API endpoint</label>
        <div className="rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] px-3 py-2.5 text-sm text-[var(--pl-muted)]">
          {location.origin}
        </div>
        <label htmlFor="settings-org">Organization</label>
        <select id="settings-org" value={org} onChange={(event) => setOrg(event.target.value)}>
          {(s.me?.orgs.length ? s.me.orgs : [s.org]).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        {error && <p className="err mt-3 text-xs">{error}</p>}
        <div className="actions">
          <button disabled={saving || org === s.org} onClick={() => void saveOrganization()}>
            {saving ? "Switching…" : "Switch organization"}
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Session</h3>
        <p className="muted">
          Signed in as <b className="text-[var(--pl-text)]">{s.me?.identityEmail ?? s.me?.token.userEmail ?? "Loading…"}</b>. Signing out also closes the active Keyname session.
        </p>
        <button
          className="danger"
          onClick={async () => {
            await Promise.allSettled([s.api.logout(), window.Keyname.signOut()]);
            s.logout();
            location.assign("/login");
          }}
        >
          Log out of dot.locker
        </button>
      </div>
    </div>
  );
}
