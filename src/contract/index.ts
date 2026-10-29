import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const freezePath = "benchmark/spec/round-00.freeze.json";
const directories = [
  "benchmark/spec",
  "benchmark/tests/public",
  "benchmark/fixtures",
  "benchmark/oracle",
  "benchmark/workloads",
  "spec/schemas",
];
const singleFiles = [
  "benchmark/tests/README.md",
  "benchmark/scripts/freeze.ts",
  "benchmark/scripts/public.ts",
  "benchmark/scripts/fixtures.ts",
  "benchmark/scripts/generate-openapi.ts",
  "benchmark/scripts/check-contract.ts",
  "benchmark/scripts/verify-vectors.py",
  "src/fixtures/index.ts",
  "src/schemas/index.ts",
  "src/contract/index.ts",
  "docs/round-00-traceability.md",
  "docs/round-00-design-decisions.md",
];
export async function contractManifest(root = ".") {
  const paths = [...singleFiles];
  async function walk(relative: string) {
    for (const entry of await readdir(join(root, relative), {
      withFileTypes: true,
    })) {
      const path = `${relative}/${entry.name}`;
      if (path === freezePath) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error(`Unsupported contract entry ${path}`);
    }
  }
  for (const path of directories) await walk(path);
  paths.sort();
  const files = [];
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    files.push({
      path,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const testDependencies = {
    zod: pkg.dependencies.zod,
    ajv: pkg.devDependencies.ajv,
    "ajv-formats": pkg.devDependencies["ajv-formats"],
  };
  const identity = {
    schemaVersion: "1",
    benchmark: { id: "slopshop-round-00", version: "0.1.0" },
    suite: { id: "round-00-public", version: "0.1.0" },
    testDependencies,
  };
  // UTF-8, no BOM; LF separators; JSON.stringify supplies unambiguous framing.
  const hash = createHash("sha256");
  hash.update("slopbench-public-contract-v1\n");
  hash.update(`${JSON.stringify(identity)}\n`);
  for (const f of files)
    hash.update(`${JSON.stringify([f.path, f.sizeBytes, f.sha256])}\n`);
  return {
    ...identity,
    algorithm: "sha256",
    framing:
      "slopbench-public-contract-v1 LF; JSON.stringify(identity) LF; sorted [path,sizeBytes,sha256] JSON tuples each followed by LF; all UTF-8",
    files,
    sha256: hash.digest("hex"),
  };
}
export async function verifyContract(root = ".") {
  const expected = await contractManifest(root);
  const recorded = JSON.parse(await readFile(join(root, freezePath), "utf8"));
  if (JSON.stringify(recorded) !== JSON.stringify(expected))
    throw new Error(
      "Frozen Round 0 contract mismatch. Preserve this release; semantic/test changes require a separately versioned contract, not a refreshed hash.",
    );
  return expected;
}
