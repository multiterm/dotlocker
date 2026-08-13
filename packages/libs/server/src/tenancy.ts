import type { Access } from "@dotlocker/shared";

export interface TenancyShadowInput {
  readonly organization: string;
  readonly subject: string;
  readonly email: string;
  readonly path: string;
  readonly access: Access;
  readonly localAllowed: boolean;
}

function organizationId(organization: string): string | undefined {
  try {
    const mappings = JSON.parse(process.env.DOTLOCKER_TENANCY_ORGANIZATIONS ?? "{}") as Record<
      string,
      unknown
    >;
    const value = mappings[organization];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function compareTenancyDecision(
  input: TenancyShadowInput,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (process.env.DOTLOCKER_TENANCY_MODE !== "shadow") return;
  const url = process.env.TENANCY_API_URL?.replace(/\/$/, "");
  const token = process.env.TENANCY_SERVICE_TOKEN;
  const mappedOrganizationId = organizationId(input.organization);
  if (!url || !token || !mappedOrganizationId) return;

  let tenancyAllowed = false;
  let reason = "request-failed";
  try {
    const response = await fetcher(`${url}/v1/authorize`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-tenancy-service": "dotlocker",
      },
      body: JSON.stringify({
        organizationId: mappedOrganizationId,
        service: "dotlocker",
        permission: `dotlocker:${input.access}`,
        principal: { subject: input.subject, email: input.email },
        resource: { path: input.path },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const decision = (await response.json()) as {
        allowed?: boolean;
        reason?: string;
      };
      tenancyAllowed = decision.allowed === true;
      reason = decision.reason ?? "unspecified";
    } else {
      reason = `http-${response.status}`;
    }
  } catch {
    // Shadow calls must never alter Dotlocker's local authorization result.
  }

  if (tenancyAllowed !== input.localAllowed) {
    console.warn("dotlocker tenancy shadow mismatch", {
      organization: input.organization,
      subject: input.subject,
      path: input.path,
      access: input.access,
      localAllowed: input.localAllowed,
      tenancyAllowed,
      reason,
    });
  }
}
