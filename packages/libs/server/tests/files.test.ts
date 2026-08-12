import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/files.js";
import { InvalidPathError, NotFoundError, PayloadTooLargeError } from "@dotlocker/shared";

describe("FileStore", () => {
  let root: string;
  let store: FileStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pluto-files-"));
    store = new FileStore({ root });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes and reads arbitrary bytes", () => {
    store.write("acme/portal/preview/config.json", Buffer.from("{}"));
    expect(store.read("acme/portal/preview/config.json").toString()).toBe("{}");
    expect(readFileSync(join(root, "acme/portal/preview/config.json")).toString()).toBe("{}");
  });

  it("overwrites atomically", () => {
    store.write("acme/portal/preview/a.txt", Buffer.from("v1"));
    store.write("acme/portal/preview/a.txt", Buffer.from("v2"));
    expect(store.read("acme/portal/preview/a.txt").toString()).toBe("v2");
  });

  it("lists a prefix", () => {
    store.write("acme/portal/preview/a.txt", Buffer.from("a"));
    store.write("acme/portal/preview/dir/b.txt", Buffer.from("b"));
    store.write("acme/portal/prod/a.txt", Buffer.from("p"));
    expect(store.list("acme/portal/preview")).toEqual([
      "acme/portal/preview/a.txt",
      "acme/portal/preview/dir/b.txt",
    ]);
  });

  it("rejects traversal", () => {
    expect(() => store.read("acme/../etc/passwd")).toThrow(InvalidPathError);
    expect(() => store.read("/etc/passwd")).toThrow(InvalidPathError);
  });

  it("deletes files", () => {
    store.write("acme/portal/preview/delete.txt", Buffer.from("x"));
    store.delete("acme/portal/preview/delete.txt");
    expect(() => store.read("acme/portal/preview/delete.txt")).toThrow(NotFoundError);
  });

  it("throws on missing", () => {
    expect(() => store.read("acme/portal/preview/missing.txt")).toThrow(NotFoundError);
  });

  it("enforces max bytes", () => {
    const small = new FileStore({ root, maxBytes: 4 });
    expect(() => small.write("acme/portal/preview/a.bin", Buffer.alloc(8))).toThrow(PayloadTooLargeError);
  });
});
