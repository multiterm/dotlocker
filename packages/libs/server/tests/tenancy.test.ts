import { afterEach, describe, expect, test, vi } from "vitest";
import { compareTenancyDecision } from "../src/tenancy.js";

const previous = {
  mode: process.env.DOTLOCKER_TENANCY_MODE,
  url: process.env.TENANCY_API_URL,
  token: process.env.TENANCY_SERVICE_TOKEN,
  organizations: process.env.DOTLOCKER_TENANCY_ORGANIZATIONS,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    DOTLOCKER_TENANCY_MODE: previous.mode,
    TENANCY_API_URL: previous.url,
    TENANCY_SERVICE_TOKEN: previous.token,
    DOTLOCKER_TENANCY_ORGANIZATIONS: previous.organizations,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

const input = {
  organization: "honeycluster",
  subject: "kn:user:admin",
  email: "r@honeycluster.io",
  path: "honeycluster/cron/prod/config.env",
  access: "read" as const,
  localAllowed: true,
};

describe("Tenancy shadow authorization", () => {
  test("does not call Tenancy unless shadow mode is configured", async () => {
    const fetcher = vi.fn();
    await compareTenancyDecision(input, fetcher as typeof fetch);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("sends the bound Keyname principal and logs mismatches", async () => {
    process.env.DOTLOCKER_TENANCY_MODE = "shadow";
    process.env.TENANCY_API_URL = "https://tenancy.example/";
    process.env.TENANCY_SERVICE_TOKEN = "service-token";
    process.env.DOTLOCKER_TENANCY_ORGANIZATIONS = JSON.stringify({
      honeycluster: "org_honeycluster",
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => Response.json({ allowed: false, reason: "no-membership" }));

    await compareTenancyDecision(input, fetcher as typeof fetch);

    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      organizationId: "org_honeycluster",
      service: "dotlocker",
      permission: "dotlocker:read",
      principal: { subject: input.subject, email: input.email },
      resource: { path: input.path },
    });
    expect(warning).toHaveBeenCalledOnce();
  });

  test("never changes local authorization when Tenancy is unavailable", async () => {
    process.env.DOTLOCKER_TENANCY_MODE = "shadow";
    process.env.TENANCY_API_URL = "https://tenancy.example";
    process.env.TENANCY_SERVICE_TOKEN = "service-token";
    process.env.DOTLOCKER_TENANCY_ORGANIZATIONS = '{"honeycluster":"org_honeycluster"}';
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(compareTenancyDecision(input, fetcher as typeof fetch)).resolves.toBeUndefined();
  });
});
