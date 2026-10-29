import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generate } from "../src/fixtures";
import { evaluate } from "../src/runner";
import { resultSchema } from "../src/schemas";
import { latest } from "../src/storage";

test(
  "controller lifecycle using a simulated Docker CLI: classifications, persistence, limits, cleanup",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "sb-runner-test-"));
    const original = {
      PATH: process.env.PATH,
      SB_CALLS: process.env.SB_CALLS,
      SB_FAILURE: process.env.SB_FAILURE,
    };
    let faulty = false;
    const fixture = join(root, "fixture");
    await generate(fixture, 12345, { products: 2, customers: 1 });
    const product = JSON.parse(
      (await Bun.file(join(fixture, "products.jsonl")).text()).split("\n")[0]!,
    );
    const server = Bun.serve({
      port: 8080,
      fetch: (r) =>
        Response.json(
          new URL(r.url).pathname === "/health"
            ? { status: "ok" }
            : {
                products: [
                  { ...product, priceMinor: faulty ? 123 : product.priceMinor },
                ],
              },
        ),
    });
    try {
      const bin = join(root, "bin");
      await Bun.write(
        join(bin, "docker"),
        `#!/bin/sh\nexec '${process.execPath}' '${resolve("tests/fake-docker.ts")}' "$@"\n`,
      );
      await chmod(join(bin, "docker"), 0o755);
      process.env.PATH = `${bin}:${process.env.PATH}`;
      process.env.SB_CALLS = join(root, "calls");
      for (const [failure, kind] of [
        ["", "passed"],
        ["assertion", "test_assertion_failure"],
        ["build", "build_failure"],
        ["startup", "startup_failure"],
        ["oom", "resource_limit_violation"],
        ["infra", "infrastructure_failure"],
        ["runtime", "candidate_runtime_failure"],
        ["timeout", "timeout"],
      ] as const) {
        process.env.SB_FAILURE = failure;
        await Bun.write(process.env.SB_CALLS!, "");
        faulty = failure === "assertion";
        const r = await evaluate({
          candidate: "examples/reference",
          fixture,
          runs: join(root, "runs"),
          executionTimeoutMs: failure === "timeout" ? 1 : 20000,
        });
        expect(resultSchema.safeParse(r).success).toBe(true);
        expect(r.status.state === "passed" ? "passed" : r.status.kind).toBe(
          kind,
        );
        expect((await latest(join(root, "runs"))).runId).toBe(r.runId);
        const calls = (await Bun.file(process.env.SB_CALLS).text())
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as string[]);
        expect(
          calls.some(
            (c) =>
              c[0] === "rm" && c[1] === "-f" && c.includes(`sb-${r.runId}`),
          ),
        ).toBe(!["infrastructure_failure", "build_failure"].includes(kind));
        if (kind === "passed") {
          expect(
            calls.some(
              (c) =>
                c.includes("--read-only") &&
                c.includes("DATABASE_PATH=/data/candidate.sqlite"),
            ),
          ).toBe(true);
          expect(await Bun.file(r.artifacts.stderr).text()).toContain(
            "candidate stderr",
          );
          expect(
            calls
              .filter((c) => c[0] === "run")
              .every(
                (c) =>
                  c.includes("--log-driver") &&
                  c.includes("json-file") &&
                  !c.includes("--publish"),
              ),
          ).toBe(true);
          expect(r.metrics.peakMemoryBytes).toBeUndefined();
          const legacy = structuredClone(r);
          delete legacy.experiment.environment.kernelRelease;
          delete legacy.experiment.environment.cpuModel;
          delete legacy.experiment.environment.logicalCpuCount;
          delete legacy.experiment.environment.hostMemoryBytes;
          expect(resultSchema.safeParse(legacy).success).toBe(true);
          expect(
            calls
              .filter((c) => c[0] === "rm")
              .every((c) => c.includes("--volumes")),
          ).toBe(true);
          expect(
            resultSchema.safeParse({
              ...r,
              correctness: { passed: 999, failed: 0 },
            }).success,
          ).toBe(false);
          expect(
            resultSchema.safeParse({ ...r, metrics: { cpuTimeSeconds: -1 } })
              .success,
          ).toBe(false);
        }
      }
      const db = new Database(join(root, "runs/index.sqlite"));
      expect(
        (db.query("SELECT count(*) AS n FROM runs").get() as { n: number }).n,
      ).toBe(8);
      db.close();
    } finally {
      server.stop(true);
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  { timeout: 30000 },
);
