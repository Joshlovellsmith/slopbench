import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { contractManifest, freezePath, verifyContract } from "../src/contract";

test("public contract freeze reproduces its hash and detects content, extra-file and dependency drift", async () => {
  const recorded = await verifyContract();
  expect(await contractManifest()).toEqual(recorded);
  const root = await mkdtemp(join(tmpdir(), "sb-contract-freeze-"));
  try {
    for (const path of [
      ...recorded.files.map((f) => f.path),
      freezePath,
      "package.json",
    ]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(path, join(root, path));
    }
    expect((await verifyContract(root)).sha256).toBe(recorded.sha256);
    const path = join(root, "benchmark/spec/round-00.md"),
      original = await Bun.file(path).text();
    await Bun.write(path, `${original}\nChanged`);
    await expect(verifyContract(root)).rejects.toThrow("mismatch");
    await Bun.write(path, original);
    const extra = join(root, "benchmark/tests/public/new-case.test.ts");
    await Bun.write(extra, "extra");
    await expect(verifyContract(root)).rejects.toThrow("mismatch");
    await rm(extra);
    const pkg = await Bun.file(join(root, "package.json")).json();
    pkg.devDependencies.ajv = "0.0.0";
    await Bun.write(join(root, "package.json"), JSON.stringify(pkg));
    await expect(verifyContract(root)).rejects.toThrow("mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
