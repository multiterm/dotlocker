import { describe, it, expect } from "vitest";
import { normalizePath, joinPath } from "../src/path.js";
import { InvalidPathError } from "../src/errors.js";

describe("normalizePath", () => {
  it("accepts arbitrary file paths under org/repo/runtime", () => {
    const r = normalizePath("acme/portal/preview/config/app.json");
    expect(r.org).toBe("acme");
    expect(r.leaf).toBe("app.json");
    expect(r.joined).toBe("acme/portal/preview/config/app.json");
  });

  it.each([
    "/acme/file.txt",
    "acme/file.txt/",
    "acme//file.txt",
    "acme/../file.txt",
    "acme/./file.txt",
    "acme\\file.txt",
    "acme/\0/file.txt",
    "Acme/file.txt",
    "a/file.txt",
  ])("rejects %s", input => {
    expect(() => normalizePath(input)).toThrow(InvalidPathError);
  });

  it("rejects non-NFC unicode", () => {
    expect(() => normalizePath("acme/portal/café.txt")).toThrow(InvalidPathError);
  });
});

describe("joinPath", () => {
  it("composes org/repo/runtime/relative path", () => {
    expect(joinPath("acme", "portal", "preview", "config/app.json")).toBe("acme/portal/preview/config/app.json");
  });
});
