const DEFAULT_ISSUER = "https://api.keyname.dev";

export interface KeynameSession {
  id: string;
  userEmail: string;
  principalType: "user" | "machine";
  subject: string;
  expiresAt: number | null;
  revokedAt: number | null;
}

export function keynameIssuer(): string {
  return (process.env.KEYNAME_ISSUER_URL ?? DEFAULT_ISSUER).replace(/\/$/, "");
}

/** Verify an auth.js access token with Keyname. Pluto never trusts claims sent
 * directly by the browser and never receives a Keyname password or refresh token. */
export async function verifyKeynameSession(accessToken: string): Promise<KeynameSession> {
  const response = await fetch(`${keynameIssuer()}/v1/auth/session`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Keyname session verification failed (${response.status})`);
  const body = (await response.json()) as {
    authenticated?: boolean;
    session?: KeynameSession;
  };
  const session = body.session;
  if (
    body.authenticated !== true ||
    !session ||
    session.principalType !== "user" ||
    !session.subject ||
    !session.userEmail ||
    session.revokedAt !== null ||
    (session.expiresAt !== null && session.expiresAt <= Date.now())
  ) {
    throw new Error("Keyname did not return an active human session");
  }
  return session;
}
