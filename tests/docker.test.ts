import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { command, evaluate } from "../src/runner";
import { snapshot } from "../src/runner/source";
import { type Result, resultSchema } from "../src/schemas";

async function assertRun(root: string, r: Result, candidate: string) {
  const artifact = resultSchema.parse(
    await Bun.file(join(root, r.runId, "result.json")).json(),
  );
  expect(artifact).toEqual(r);
  expect(artifact.experiment.candidate.sourceHash).toBe(
    await snapshot(candidate),
  );
  const db = new Database(join(root, "index.sqlite"), { readonly: true });
  try {
    expect(db.query("SELECT * FROM runs WHERE id = ?").get(r.runId)).toEqual({
      id: r.runId,
      started_at: r.startedAt,
      candidate: r.experiment.candidate.id,
      status: r.status.state,
      artifact: resolve(root, r.runId, "result.json"),
    });
    expect(db.query("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  } finally {
    db.close();
  }
  expect(await command(["ps", "-aq", "--filter", `name=sb-${r.runId}`])).toBe(
    "",
  );
  expect(
    await command([
      "network",
      "ls",
      "-q",
      "--filter",
      `name=sb-${r.runId}-net`,
    ]),
  ).toBe("");
  for (const path of Object.values(r.artifacts))
    expect(await Bun.file(path).exists()).toBe(true);
}
const dockerTest = test.skipIf(process.env.SLOPBENCH_DOCKER_TEST !== "1");
dockerTest(
  "real Docker: conforming/faulty outcomes, JSON, SQLite, source hashes and cleanup",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "sb-real-"));
    const baseline = (await readdir(tmpdir())).filter((n) =>
      n.startsWith("slopbench-"),
    );
    try {
      const good = await evaluate({
        candidate: "examples/reference",
        runs: root,
      });
      expect(good.status, JSON.stringify(good.status)).toEqual({
        state: "passed",
      });
      expect(good.correctness).toEqual({ passed: 2, failed: 0 });
      await assertRun(root, good, "examples/reference");
      const bad = await evaluate({
        candidate: "examples/reference",
        runs: root,
        faulty: true,
      });
      expect(bad.status).toMatchObject({
        state: "failed",
        kind: "test_assertion_failure",
      });
      expect(bad.correctness).toEqual({ passed: 1, failed: 1 });
      await assertRun(root, bad, "examples/reference");
      expect(good.experiment.candidate.sourceHash).toBe(
        bad.experiment.candidate.sourceHash,
      );
      expect(
        (await readdir(tmpdir()))
          .filter((n) => n.startsWith("slopbench-"))
          .sort(),
      ).toEqual(baseline.sort());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  { timeout: 180000 },
);
dockerTest(
  "real Docker: build and runtime cannot see host socket, unrelated files, or evaluator canaries",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "sb-boundary-"));
    const candidate = join(root, "candidate");
    const runs = join(root, "runs");
    const original = process.env.SLOPBENCH_HOST_ONLY_CANARY;
    try {
      await mkdir(candidate);
      const unrelated = join(root, "unrelated-host-file");
      const evaluator = join(root, "evaluator-resources", "canary");
      // Synthetic canaries only. No real private evaluator or secret is inspected.
      await Bun.write(unrelated, "unrelated host data");
      await Bun.write(evaluator, "synthetic evaluator resource");
      const paths = [
        "/var/run/docker.sock",
        "/run/docker.sock",
        unrelated,
        evaluator,
        resolve("README.md"),
        resolve("src/harness/smoke.ts"),
      ];
      await Bun.write(
        join(candidate, "probe-paths.json"),
        JSON.stringify(paths),
      );
      await copyFile(
        "examples/reference/server.ts",
        join(candidate, "server.ts"),
      );
      await copyFile(
        "tests/isolation-probe.ts",
        join(candidate, "boundary.ts"),
      );
      const manifest = await Bun.file(
        "examples/reference/candidate.json",
      ).json();
      await Bun.write(
        join(candidate, "candidate.json"),
        JSON.stringify({
          ...manifest,
          id: "isolation-probe",
          build: ["bun", "boundary.ts"],
          start: ["bun", "boundary.ts", "serve"],
        }),
      );
      process.env.SLOPBENCH_HOST_ONLY_CANARY = "must-not-enter-container";
      const result = await evaluate({ candidate, runs });
      expect(result.status, JSON.stringify(result.status)).toEqual({
        state: "passed",
      });
      await assertRun(runs, result, candidate);
      for (const path of [result.artifacts.buildLog, result.artifacts.stdout])
        expect(await Bun.file(path).text()).toContain(
          '"isolationProbe":"passed"',
        );
    } finally {
      if (original === undefined) delete process.env.SLOPBENCH_HOST_ONLY_CANARY;
      else process.env.SLOPBENCH_HOST_ONLY_CANARY = original;
      await rm(root, { recursive: true, force: true });
    }
  },
  { timeout: 180000 },
);
