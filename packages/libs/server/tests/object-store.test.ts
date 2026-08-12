import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { S3ObjectStore } from "../src/object-store.js";

const endpoint = process.env.DOTLOCKER_TEST_S3_ENDPOINT;
const credentials =
  process.env.DOTLOCKER_TEST_S3_ACCESS_KEY && process.env.DOTLOCKER_TEST_S3_SECRET_KEY
    ? {
        accessKeyId: process.env.DOTLOCKER_TEST_S3_ACCESS_KEY,
        secretAccessKey: process.env.DOTLOCKER_TEST_S3_SECRET_KEY,
      }
    : undefined;

describe.skipIf(!endpoint || !credentials)("S3ObjectStore", () => {
  const bucket = process.env.DOTLOCKER_TEST_S3_BUCKET ?? "dotlocker-preview";
  let store: S3ObjectStore;
  beforeAll(async () => {
    store = new S3ObjectStore({ endpoint: endpoint!, region: "garage", bucket, ...credentials! });
  });
  it("round-trips paths and content-addressed blobs", async () => {
    const body = Buffer.from("garage object");
    const path = `dotlocker-test/${Date.now()}/preview/file.txt`;
    await store.write(path, body);
    expect((await store.read(path)).toString()).toBe("garage object");
    expect(await store.list(path.split("/").slice(0, -1).join("/"))).toContain(path);
    const hash = await store.writeBlob(body);
    expect(await store.readBlob(hash)).toEqual(body);
    await store.delete(path);
    expect(await store.exists(path)).toBe(false);
  });
});
