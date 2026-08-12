// #region -- Pluto client HTTP wrapper ---------------------

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PlutoError,
  UnauthorizedError,
} from "@multiterm/pluto-shared";

export interface ClientCredentials {
  readonly server: string;
  readonly token: string;
}

export interface ResolveResponse {
  readonly files: readonly string[];
}

export interface RuntimeVersionFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface RuntimeVersion {
  readonly hash: string;
  readonly shortHash: string;
  readonly treeHash: string;
  readonly parentHash: string | null;
  readonly org: string;
  readonly repo: string;
  readonly runtime: string;
  readonly createdAt: number;
  readonly createdBy: string | null;
  readonly files: readonly RuntimeVersionFile[];
}

export interface LoginResponse {
  readonly token: string;
  readonly tokenId: string;
  readonly expiresAt: number;
  readonly user?: unknown;
  readonly userEmail?: string;
  readonly grants: readonly unknown[];
}

export class PlutoClient {
  readonly #server: string;
  readonly #token: string;

  constructor(creds: ClientCredentials) {
    this.#server = creds.server.replace(/\/$/, "");
    this.#token = creds.token;
  }

  async health(): Promise<{ ok: boolean; version: string }> {
    const r = await fetch(`${this.#server}/v1/health`);
    return (await r.json()) as { ok: boolean; version: string };
  }

  async resolve(org: string, repo: string, runtime?: string | null): Promise<ResolveResponse> {
    const suffix = runtime ? `/${runtime}` : "";
    const url = new URL(`${this.#server}/v1/resolve/${org}/${repo}${suffix}`);
    const r = await fetch(url, { headers: this.#authHeaders() });
    await this.#assertOk(r, url.toString());
    return (await r.json()) as ResolveResponse;
  }

  async login(email: string, password: string, org: string, totp?: string): Promise<LoginResponse> {
    const url = `${this.#server}/v1/auth/login`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, org, ...(totp ? { totp } : {}) }),
    });
    await this.#assertOk(r, url);
    return (await r.json()) as LoginResponse;
  }

  async getFile(storagePath: string): Promise<Buffer> {
    const url = `${this.#server}/v1/files/${storagePath}`;
    const r = await fetch(url, { headers: this.#authHeaders() });
    await this.#assertOk(r, url);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }

  async putFile(storagePath: string, body: Buffer): Promise<void> {
    const url = `${this.#server}/v1/files/${storagePath}`;
    const r = await fetch(url, {
      method: "PUT",
      headers: {
        ...this.#authHeaders(),
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array(body),
    });
    await this.#assertOk(r, url);
  }

  async putRuntimeObject(
    org: string,
    repo: string,
    runtime: string,
    sha256: string,
    body: Buffer,
  ): Promise<void> {
    const url = `${this.#server}/v1/runtimes/${org}/${repo}/${runtime}/objects/${sha256}`;
    const r = await fetch(url, {
      method: "PUT",
      headers: { ...this.#authHeaders(), "content-type": "application/octet-stream" },
      body: new Uint8Array(body),
    });
    await this.#assertOk(r, url);
  }

  async runtimeHead(org: string, repo: string, runtime: string): Promise<RuntimeVersion | null> {
    const url = `${this.#server}/v1/runtimes/${org}/${repo}/${runtime}/head`;
    const r = await fetch(url, { headers: this.#authHeaders() });
    await this.#assertOk(r, url);
    return ((await r.json()) as { version: RuntimeVersion | null }).version;
  }

  async commitRuntime(
    org: string,
    repo: string,
    runtime: string,
    files: readonly RuntimeVersionFile[],
    expectedParentHash?: string | null,
  ): Promise<{ created: boolean; version: RuntimeVersion }> {
    const url = `${this.#server}/v1/runtimes/${org}/${repo}/${runtime}/versions`;
    const r = await fetch(url, {
      method: "POST",
      headers: { ...this.#authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        files,
        ...(expectedParentHash !== undefined ? { expectedParentHash } : {}),
      }),
    });
    await this.#assertOk(r, url);
    return (await r.json()) as { created: boolean; version: RuntimeVersion };
  }

  async runtimeVersions(
    org: string,
    repo: string,
    runtime: string,
  ): Promise<readonly RuntimeVersion[]> {
    const url = `${this.#server}/v1/runtimes/${org}/${repo}/${runtime}/versions`;
    const r = await fetch(url, { headers: this.#authHeaders() });
    await this.#assertOk(r, url);
    return ((await r.json()) as { versions: RuntimeVersion[] }).versions;
  }

  #authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.#token}` };
  }

  async #assertOk(r: Response, url: string): Promise<void> {
    if (r.ok) return;
    let detail: string | undefined;
    try {
      const json = (await r.json()) as { error?: string };
      detail = json.error;
    } catch {
      // ignore
    }
    if (r.status === 401) {
      throw new UnauthorizedError();
    }
    if (r.status === 403) {
      throw new ForbiddenError(detail ?? `forbidden: ${url}`);
    }
    if (r.status === 404) {
      throw new NotFoundError(detail ?? `not found: ${url}`);
    }
    if (r.status === 409) {
      throw new ConflictError(detail ?? `conflict: ${url}`);
    }
    throw new PlutoError(
      "PLUTO_SERVER_UNREACHABLE",
      `request failed (${r.status}): ${detail ?? url}`,
      r.status,
    );
  }
}

// #endregion ------------------------------------------------
