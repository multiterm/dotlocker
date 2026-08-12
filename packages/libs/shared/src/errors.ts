// #region -- Typed Errors ----------------------------------

export type ErrorCode =
  | "PLUTO_INVALID_PATH"
  | "PLUTO_INVALID_SCOPE"
  | "PLUTO_INVALID_ORG"
  | "PLUTO_INVALID_TOKEN"
  | "PLUTO_TOKEN_EXPIRED"
  | "PLUTO_TOKEN_REVOKED"
  | "PLUTO_EMAIL_UNVERIFIED"
  | "PLUTO_FORBIDDEN"
  | "PLUTO_NOT_FOUND"
  | "PLUTO_CONFLICT"
  | "PLUTO_PAYLOAD_TOO_LARGE"
  | "PLUTO_QUOTA_EXCEEDED"
  | "PLUTO_RATE_LIMITED"
  | "PLUTO_CONFIG_MISSING"
  | "PLUTO_CONFIG_INVALID"
  | "PLUTO_SERVER_UNREACHABLE";

export class PlutoError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: unknown;
  constructor(code: ErrorCode, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "PlutoError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export class InvalidPathError extends PlutoError {
  constructor(
    message: string,
    public readonly input: string,
  ) {
    super("PLUTO_INVALID_PATH", message, 400, { input });
    this.name = "InvalidPathError";
  }
}

export class InvalidScopeError extends PlutoError {
  constructor(
    message: string,
    public readonly scope: string,
  ) {
    super("PLUTO_INVALID_SCOPE", message, 400, { scope });
    this.name = "InvalidScopeError";
  }
}

export class ForbiddenError extends PlutoError {
  constructor(message = "forbidden") {
    super("PLUTO_FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends PlutoError {
  constructor(code: ErrorCode = "PLUTO_INVALID_TOKEN", message = "unauthorized") {
    super(code, message, 401);
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends PlutoError {
  constructor(message = "not found") {
    super("PLUTO_NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends PlutoError {
  constructor(message: string) {
    super("PLUTO_CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class PayloadTooLargeError extends PlutoError {
  constructor(
    message: string,
    public readonly limit: number,
  ) {
    super("PLUTO_PAYLOAD_TOO_LARGE", message, 413, { limit });
    this.name = "PayloadTooLargeError";
  }
}

export class QuotaExceededError extends PlutoError {
  constructor(message: string) {
    super("PLUTO_QUOTA_EXCEEDED", message, 507);
    this.name = "QuotaExceededError";
  }
}

export class ConfigError extends PlutoError {
  constructor(
    code: "PLUTO_CONFIG_MISSING" | "PLUTO_CONFIG_INVALID",
    message: string,
    public readonly field?: string,
  ) {
    super(code, message, 0, { field });
    this.name = "ConfigError";
  }
}

// #endregion ------------------------------------------------
