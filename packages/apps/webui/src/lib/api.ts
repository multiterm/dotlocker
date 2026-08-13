import { DotlockerApiError } from "./errors";

export interface LoginResponse {
  token: string;
  tokenId: string;
  expiresAt: number;
  org: string;
  orgs: string[];
  userEmail?: string;
  grants: unknown[];
}
export interface FileRecord {
  path: string;
  org: string;
  repo: string;
  runtime: string;
  relPath: string;
  size: number;
  sha256: string;
  uploadedBy: string | null;
  createdAt: number;
  updatedAt: number;
  publicUrl?: string | null;
}

export interface RuntimeVersionFile {
  path: string;
  sha256: string;
  size: number;
}
export interface RuntimeVersion {
  hash: string;
  shortHash: string;
  treeHash: string;
  parentHash: string | null;
  org: string;
  repo: string;
  runtime: string;
  createdAt: number;
  createdBy: string | null;
  files: RuntimeVersionFile[];
}

export interface GrantRecord {
  kind: "org" | "repo" | "runtime";
  email: string;
  org: string;
  repo: string | null;
  runtime: string | null;
  access: "read" | "write" | "admin";
  createdAt: number;
}

export interface AuditEntry {
  ts?: number;
  org: string;
  tokenId: string | null;
  action: string;
  path: string;
  status: number;
  ip: string | null;
  warning?: string | null;
}

export interface WebhookRecord {
  id: string;
  org: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastDeliveredAt: number | null;
  lastStatus: number | null;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  responseStatus: number | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface ApiKeyRecord {
  id: string;
  org: string;
  label: string;
  userEmail: string | null;
  service: string | null;
  scopes: Array<{ path: string; access: "read" | "write" | "admin" }>;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

export interface StorageStatus {
  backend: "garage" | "filesystem";
  connected: boolean;
  bucket: string | null;
  files: number;
  bytes: number;
  objects: number;
  missing: string[];
  orphaned: string[];
  checkedAt: number;
}

export interface MeResponse {
  token: {
    id: string;
    org: string;
    userEmail?: string;
    service?: string;
    scopes: unknown[];
    expiresAt?: number;
  };
  identityEmail?: string;
  orgs: string[];
  grants: unknown[];
}

const jsonHeaders = { "content-type": "application/json" };

export class PlutoApi {
  constructor(
    readonly server: string,
    readonly token?: string,
  ) {}

  private url(path: string): string {
    return `${this.server || location.origin}${path}`;
  }
  private headers(json = true): Record<string, string> {
    return {
      ...(json ? jsonHeaders : {}),
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
    };
  }
  async request<T>(path: string, init: RequestInit = {}, json = true): Promise<T> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: { ...this.headers(json), ...(init.headers as Record<string, string> | undefined) },
    });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.json() : await res.text();
    if (!res.ok) {
      const row =
        body && typeof body === "object"
          ? (body as { code?: string; error?: string; message?: string; action?: string })
          : {};
      throw new DotlockerApiError(
        row.code ?? row.error ?? `DOTLOCKER_HTTP_${res.status}`,
        row.message,
        row.action,
        res.status,
      );
    }
    return body as T;
  }
  establishKeynameSession(accessToken: string): Promise<Omit<LoginResponse, "token" | "tokenId">> {
    return this.request(
      "/v1/auth/keyname/session",
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
      },
      false,
    );
  }
  switchOrg(org: string): Promise<MeResponse> {
    return this.request("/v1/auth/switch-org", { method: "POST", body: JSON.stringify({ org }) });
  }
  createOrganization(name: string): Promise<{ org: string }> {
    return this.request("/v1/orgs", { method: "POST", body: JSON.stringify({ name }) });
  }
  async logout(): Promise<void> {
    await this.request("/v1/auth/logout", { method: "POST" }, false);
  }
  me(): Promise<MeResponse> {
    return this.request("/v1/me", {}, false);
  }
  files(org: string, repo?: string, runtime?: string): Promise<{ files: FileRecord[] }> {
    return this.request(
      `/v1/files-meta/${[org, repo, runtime].filter(Boolean).join("/")}`,
      {},
      false,
    );
  }
  async upload(path: string, file: File | Blob | ArrayBuffer): Promise<void> {
    const body = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    await this.request(`/v1/files/${path}`, { method: "PUT", body }, false);
  }
  async download(path: string): Promise<Blob> {
    const response = await fetch(this.url(`/v1/files/${path}`), { headers: this.headers(false) });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      throw new DotlockerApiError(
        body.error ?? `DOTLOCKER_HTTP_${response.status}`,
        body.message,
        undefined,
        response.status,
      );
    }
    return response.blob();
  }
  async text(path: string): Promise<string> {
    return (await this.download(path)).text();
  }
  runtimeHead(
    org: string,
    repo: string,
    runtime: string,
  ): Promise<{ version: RuntimeVersion | null }> {
    return this.request(`/v1/runtimes/${org}/${repo}/${runtime}/head`, {}, false);
  }
  runtimeVersions(
    org: string,
    repo: string,
    runtime: string,
  ): Promise<{ versions: RuntimeVersion[] }> {
    return this.request(`/v1/runtimes/${org}/${repo}/${runtime}/versions`, {}, false);
  }
  commitRuntime(
    org: string,
    repo: string,
    runtime: string,
    files: RuntimeVersionFile[],
    expectedParentHash?: string | null,
  ): Promise<{ created: boolean; version: RuntimeVersion }> {
    return this.request(`/v1/runtimes/${org}/${repo}/${runtime}/versions`, {
      method: "POST",
      body: JSON.stringify({ files, expectedParentHash }),
    });
  }
  async deleteFile(path: string): Promise<void> {
    await this.request(`/v1/files/${path}`, { method: "DELETE" }, false);
  }
  publishFile(path: string): Promise<{ id: string; path: string; url: string }> {
    return this.request("/v1/public-files", { method: "POST", body: JSON.stringify({ path }) });
  }
  async unpublishFile(path: string): Promise<void> {
    await this.request("/v1/public-files", { method: "DELETE", body: JSON.stringify({ path }) });
  }
  grants(org: string): Promise<{ grants: GrantRecord[] }> {
    return this.request(`/v1/grants/${org}`, {}, false);
  }
  async revokeGrant(grant: Pick<GrantRecord, "email" | "org" | "repo" | "runtime">): Promise<void> {
    await this.request("/v1/grants", { method: "DELETE", body: JSON.stringify(grant) });
  }
  storageStatus(): Promise<StorageStatus> {
    return this.request("/v1/operations/storage", {}, false);
  }
  audit(org: string, limit = 100): Promise<{ audit: AuditEntry[] }> {
    return this.request(`/v1/audit/${org}?limit=${limit}`, {}, false);
  }
  webhooks(): Promise<{ webhooks: WebhookRecord[] }> {
    return this.request("/v1/webhooks", {}, false);
  }
  createWebhook(input: {
    name: string;
    url: string;
    events: string[];
  }): Promise<{ webhook: WebhookRecord; secret: string }> {
    return this.request("/v1/webhooks", { method: "POST", body: JSON.stringify(input) });
  }
  updateWebhook(
    id: string,
    patch: Partial<Pick<WebhookRecord, "name" | "url" | "events" | "enabled">>,
  ): Promise<{ webhook: WebhookRecord }> {
    return this.request(`/v1/webhooks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }
  async deleteWebhook(id: string): Promise<void> {
    await this.request(`/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" }, false);
  }
  webhookDeliveries(id: string): Promise<{ deliveries: WebhookDelivery[] }> {
    return this.request(`/v1/webhooks/${encodeURIComponent(id)}/deliveries`, {}, false);
  }
  tokens(): Promise<{ tokens: ApiKeyRecord[]; sessions?: ApiKeyRecord[] }> {
    return this.request("/v1/tokens", {}, false);
  }
  createToken(input: {
    label?: string;
    scopes: Array<{ path: string; access: string }>;
    expiresSeconds?: number;
  }): Promise<{ token: string; record: ApiKeyRecord }> {
    return this.request("/v1/tokens", { method: "POST", body: JSON.stringify(input) });
  }
  async revokeToken(id: string): Promise<void> {
    await this.request(`/v1/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }, false);
  }
  createUser(input: { org: string; email: string }): Promise<unknown> {
    return this.request("/v1/users", { method: "POST", body: JSON.stringify(input) });
  }
  grant(input: Record<string, unknown> & { runtime?: string }): Promise<unknown> {
    return this.request(input.runtime ? "/v1/grants/runtime" : "/v1/grants/repo", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
}
