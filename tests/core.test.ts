import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generate,
  prng,
  records,
  serialize,
  shaFile,
  verify,
} from "../src/fixtures";
import { smoke } from "../src/harness/smoke";
import { snapshot } from "../src/runner/source";
import { customerSchema, productSchema, resultSchema } from "../src/schemas";

const dirs: string[] = [];
async function temp() {
  const path = await mkdtemp(join(tmpdir(), "sb-test-"));
  dirs.push(path);
  return path;
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
test("LCG pinned vector and repeatability", () => {
  const a = prng(12345),
    b = prng(12345);
  expect([a(), a(), a()]).toEqual([87628868, 71072467, 2332836374]);
  for (let i = 0; i < 100; i++) expect(prng(i)()).toBe(prng(i)());
  expect(b()).toBe(87628868);
});
test("fixture bytes, schemas, ordering, seed sensitivity and hashes", async () => {
  const a = await temp(),
    b = await temp(),
    c = await temp();
  const counts = { products: 40, customers: 20 };
  const manifest = await generate(a, 12345, counts);
  await generate(b, 12345, counts);
  await generate(c, 12346, counts);
  for (const name of ["products.jsonl", "customers.jsonl", "manifest.json"]) {
    expect(await Bun.file(join(a, name)).text()).toBe(
      await Bun.file(join(b, name)).text(),
    );
  }
  expect(await shaFile(join(a, "products.jsonl"))).not.toBe(
    await shaFile(join(c, "products.jsonl")),
  );
  expect(await verify(a)).toEqual(manifest);
  for await (const r of records(join(a, "products.jsonl")))
    expect(productSchema.safeParse(r).success).toBe(true);
  for await (const r of records(join(a, "customers.jsonl")))
    expect(customerSchema.safeParse(r).success).toBe(true);
  expect(manifest.files["products.jsonl"]).toBe(
    await shaFile(join(a, "products.jsonl")),
  );
  await Bun.write(join(a, "products.jsonl"), "{}\n");
  expect(verify(a)).rejects.toThrow("Hash mismatch");
});
test("serialization has stable UTF-8 and LF; invalid counts/seeds rejected", async () => {
  expect(serialize({ id: "café", priceMinor: 0 })).toBe(
    '{"id":"café","priceMinor":0}\n',
  );
  const dir = await temp();
  expect(generate(dir, -1, { products: 0, customers: 0 })).rejects.toThrow();
  expect(generate(dir, 0, { products: -1, customers: 0 })).rejects.toThrow();
});
test("fingerprint ignores dependency directories, includes names, content and executable bit; rejects symlinks", async () => {
  const a = await temp(),
    b = await temp();
  await Bun.write(join(a, "file"), "first");
  const original = await snapshot(a, b);
  expect(await snapshot(b)).toBe(original);
  await Bun.write(join(a, "node_modules/ignored"), "ignored");
  expect(await snapshot(a)).toBe(original);
  await Bun.write(join(a, "file"), "changed");
  expect(await snapshot(a)).not.toBe(original);
  const { symlink, chmod } = await import("node:fs/promises");
  await chmod(join(a, "file"), 0o755);
  expect(await snapshot(a)).not.toBe(await snapshot(b));
  await symlink("/etc/passwd", join(a, "link"));
  expect(snapshot(a)).rejects.toThrow("Unsupported candidate file");
});
test("public HTTP smoke checks deterministic data and records latency", async () => {
  const dir = await temp();
  await generate(dir, 1, { products: 1, customers: 0 });
  const p = JSON.parse(
    (await Bun.file(join(dir, "products.jsonl")).text()).trim(),
  );
  let faulty = false;
  const server = Bun.serve({
    port: 0,
    fetch: (r) =>
      Response.json(
        new URL(r.url).pathname === "/health"
          ? { status: "ok" }
          : {
              products: [{ ...p, priceMinor: p.priceMinor + (faulty ? 1 : 0) }],
            },
      ),
  });
  try {
    const success = await smoke(
      server.url.toString().replace(/\/$/, ""),
      p,
      AbortSignal.timeout(5000),
    );
    expect(success.every((t) => t.status === "passed")).toBe(true);
    expect(success[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    faulty = true;
    expect(
      (
        await smoke(
          server.url.toString().replace(/\/$/, ""),
          p,
          AbortSignal.timeout(5000),
        )
      )[1]!.status,
    ).toBe("failed");
  } finally {
    server.stop(true);
  }
});
test("validation rejects missing identities, wrong schema versions and fractional prices", () => {
  expect(resultSchema.safeParse({ schemaVersion: "2" }).success).toBe(false);
  expect(productSchema.safeParse({ priceMinor: 1.5 }).success).toBe(false);
});

test("published Small fixture pins generator v1 bytes and validates", async () => {
  const dir = await temp();
  await generate(dir, 12345, { products: 1000, customers: 200 });
  const manifest = await verify("fixtures/small");
  expect(manifest.files["products.jsonl"]).toBe(
    "93679d77a698e37adbfc8712d6efb3c5ea20e12d9999b62acb232d3e2bb3c751",
  );
  expect(manifest.files["customers.jsonl"]).toBe(
    "b732d1b246f61160442c023a63b02a5be06f06b77ee1e4ce3d7bac8118ecdee2",
  );
  for (const name of ["products.jsonl", "customers.jsonl", "manifest.json"]) {
    expect(await Bun.file(join(dir, name)).text()).toBe(
      await Bun.file(join("fixtures/small", name)).text(),
    );
  }
});
