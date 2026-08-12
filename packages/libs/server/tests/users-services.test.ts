import { describe, expect, it, beforeEach } from "vitest";
import {
  openDb,
  createOrg,
  createUser,
  verifyUserEmail,
  upsertService,
  serviceWarningForRequest,
  mintToken,
  type DB,
} from "../src/index.js";
import { UnauthorizedError } from "@dotlocker/shared";

describe("users and services", () => {
  let db: DB;

  beforeEach(() => {
    db = openDb(":memory:");
    createOrg(db, "honeycluster");
  });

  it("requires verified email users before owner-bound token minting", () => {
    createUser(db, {
      email: "r@honeycluster.io",
      password: "generated-password-at-least-16",
    });
    upsertService(db, {
      org: "honeycluster",
      name: "portal",
      ownerEmail: "r@honeycluster.io",
      allowedSources: ["127.0.0.1", "region:us"],
    });
    expect(() => mintToken(db, {
      org: "honeycluster",
      service: "portal",
      userEmail: "r@honeycluster.io",
      scopes: [{ path: "honeycluster/portal/**", access: "read" }],
    })).toThrow(UnauthorizedError);

    verifyUserEmail(db, "r@honeycluster.io");
    const { record } = mintToken(db, {
      org: "honeycluster",
      service: "portal",
      userEmail: "r@honeycluster.io",
      scopes: [{ path: "honeycluster/portal/**", access: "read" }],
    });
    expect(record.userEmail).toBe("r@honeycluster.io");
    expect(record.service).toBe("portal");
  });

  it("warns when a service token is used from an unregistered source", () => {
    const service = upsertService(db, {
      org: "honeycluster",
      name: "portal",
      allowedSources: ["10.0.0.0/8", "region:us"],
    });
    expect(serviceWarningForRequest(service, "10.1.2.3", null)).toBeNull();
    expect(serviceWarningForRequest(service, "192.0.2.10", "us")).toBeNull();
    expect(serviceWarningForRequest(service, "192.0.2.10", "eu")).toContain("not registered");
  });
});
