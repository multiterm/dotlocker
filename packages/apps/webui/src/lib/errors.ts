const messages: Record<string, { message: string; action?: string }> = {
  PLUTO_NOT_FOUND: {
    message: "Your Keyname identity has not been provisioned in this Dotlocker workspace.",
    action: "Ask an organization administrator to provision your verified Keyname email.",
  },
  PLUTO_FORBIDDEN: {
    message: "You do not have access to this organization, repository, or runtime.",
    action: "Request a scoped grant from an organization administrator.",
  },
  PLUTO_UNAUTHORIZED: {
    message: "Your Dotlocker session is missing or no longer valid.",
    action: "Sign in with Keyname again.",
  },
  PLUTO_TOKEN_EXPIRED: {
    message: "This API key or session has expired.",
    action: "Sign in again or rotate the API key.",
  },
  PLUTO_TOKEN_REVOKED: {
    message: "This API key or session was revoked.",
    action: "Create a replacement credential.",
  },
  PLUTO_KEYNAME_AUTH_REQUIRED: {
    message: "Keyname sign-in is required.",
    action: "Continue with Keyname to establish a Dotlocker session.",
  },
  PLUTO_KEYNAME_AUTH_FAILED: {
    message: "Dotlocker could not verify the Keyname session.",
    action: "Refresh the page and sign in again.",
  },
  PLUTO_OBJECT_HASH_MISMATCH: {
    message: "The uploaded object did not match its expected checksum.",
    action: "Retry the upload. Dotlocker did not save the invalid object.",
  },
};

export class DotlockerApiError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly action?: string,
    readonly status?: number,
  ) {
    const known = messages[code];
    super(
      message && message !== code
        ? message
        : (known?.message ?? "Dotlocker could not complete the request."),
    );
    this.name = "DotlockerApiError";
    this.action = action ?? known?.action;
  }
}

export function errorMessage(reason: unknown): string {
  if (reason instanceof DotlockerApiError)
    return `${reason.message}${reason.action ? ` ${reason.action}` : ""}`;
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object") {
    const row = reason as { code?: string; error?: string; message?: string; action?: string };
    const code = row.code ?? row.error;
    if (code) return errorMessage(new DotlockerApiError(code, row.message, row.action));
  }
  return "Dotlocker could not complete the request.";
}
