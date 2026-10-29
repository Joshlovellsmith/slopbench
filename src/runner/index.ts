import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { isIP } from "node:net";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, relative, resolve } from "node:path";
import { records, verify } from "../fixtures";
import { smoke } from "../harness/smoke";
import { candidateSchema, type FailureKind, type Result } from "../schemas";
import { saveResult } from "../storage";
import { snapshot } from "./source";
export class RunFailure extends Error {
  constructor(
    public kind: FailureKind,
    message: string,
  ) {
    super(message);
  }
}
export class DockerError extends Error {
  constructor(
    public exitCode: number,
    message: string,
  ) {
    super(message);
  }
}
export async function command(args: string[], timeoutMs = 30000, log?: string) {
  const fd = log ? openSync(log, "w") : undefined;
  let timedOut = false;
  const p = Bun.spawn(["docker", ...args], {
    stdout: fd ?? "pipe",
    stderr: fd ?? "pipe",
    env: { ...process.env },
  });
  const timer = setTimeout(() => {
    timedOut = true;
    p.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      p.stdout instanceof ReadableStream
        ? new Response(p.stdout).text()
        : Promise.resolve(""),
      p.stderr instanceof ReadableStream
        ? new Response(p.stderr).text()
        : Promise.resolve(""),
      p.exited,
    ]);
    if (timedOut)
      throw new RunFailure(
        "timeout",
        `Docker ${args[0]} exceeded ${timeoutMs} ms`,
      );
    if (code !== 0)
      throw new DockerError(
        code,
        `docker ${args[0]} (${code}): ${stderr || stdout}${log ? `; see ${log}` : ""}`,
      );
    return stdout.trim();
  } finally {
    clearTimeout(timer);
    if (fd !== undefined) closeSync(fd);
  }
}
export interface Options {
  candidate: string;
  fixture?: string;
  runs?: string;
  readinessTimeoutMs?: number;
  executionTimeoutMs?: number;
  buildTimeoutMs?: number;
  buildNetwork?: "none" | "default";
  faulty?: boolean;
}
export async function evaluate(options: Options) {
  const runId = randomUUID();
  const runs = resolve(options.runs ?? "runs");
  const artifactDir = join(runs, runId);
  await mkdir(artifactDir, { recursive: true });
  const temp = await mkdtemp(join(tmpdir(), "slopbench-"));
  const workspace = join(temp, "workspace");
  const state = join(temp, "data");
  const fixtureInput = resolve(options.fixture ?? "fixtures/small");
  const fixture = join(temp, "fixtures");
  const runtimeName = `sb-${runId}`;
  const buildName = `${runtimeName}-build`;
  const network = `${runtimeName}-net`;
  const readiness = options.readinessTimeoutMs ?? 10000;
  const execution = options.executionTimeoutMs ?? 20000;
  const buildTimeout = options.buildTimeoutMs ?? 60000;
  let result: Result | undefined;
  let launched = false;
  let buildAttempted = false;
  let runtimeAttempted = false;
  let networkAttempted = false;
  let interrupted = false;
  const interruptSignal = new AbortController();
  const pendingStops: Promise<unknown>[] = [];
  const interrupt = () => {
    interrupted = true;
    interruptSignal.abort();
    for (const name of [buildName, runtimeName])
      pendingStops.push(command(["kill", name]).catch(() => {}));
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let cleanupError = "";
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let executionExpired = false;
  try {
    const candidateRoot = await realpath(options.candidate);
    const repositoryRoot = resolve(import.meta.dir, "../..");
    const repositoryRelative = relative(candidateRoot, repositoryRoot);
    if (
      repositoryRelative === "" ||
      (!repositoryRelative.startsWith("..") &&
        !repositoryRelative.startsWith("/"))
    )
      throw new Error(
        "Candidate workspace must not contain the SlopBench repository root",
      );
    const sourceHash = await snapshot(candidateRoot, workspace);
    await mkdir(fixture);
    for (const name of ["manifest.json", "products.jsonl", "customers.jsonl"])
      await copyFile(join(fixtureInput, name), join(fixture, name));
    const manifest = candidateSchema.parse(
      JSON.parse(await readFile(join(workspace, "candidate.json"), "utf8")),
    );
    const fixtureManifest = await verify(fixture);
    if (fixtureManifest.counts.products === 0)
      throw new Error("Smoke contract requires at least one product");
    await mkdir(state);
    await chmod(state, 0o777);
    const stdout = join(artifactDir, "stdout.log"),
      stderr = join(artifactDir, "stderr.log"),
      buildLog = join(artifactDir, "build.log");
    await Promise.all([
      Bun.write(stdout, ""),
      Bun.write(stderr, ""),
      Bun.write(buildLog, ""),
    ]);
    result = {
      schemaVersion: "1",
      runId,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      experiment: {
        benchmark: { id: "slopbench-smoke", version: "1" },
        candidate: {
          id: manifest.id,
          sourceHash,
          language: manifest.language,
          runtime: manifest.runtime,
        },
        development: {},
        fixture: fixtureManifest,
        environment: {
          platform: platform(),
          kernelRelease: release(),
          cpuModel: cpus()[0]?.model ?? "unknown",
          logicalCpuCount: cpus().length,
          hostMemoryBytes: totalmem(),
          architecture: arch(),
          controllerRuntime: Bun.version,
          image: manifest.image,
          cpuLimit: 1,
          memoryLimitBytes: 268435456,
          executionTimeoutMs: execution,
          readinessTimeoutMs: readiness,
          buildTimeoutMs: buildTimeout,
          buildNetwork: options.buildNetwork ?? "none",
        },
        suite: { id: "public-smoke", version: "1" },
      },
      status: { state: "passed" },
      tests: [],
      correctness: { passed: 0, failed: 0 },
      metrics: {},
      container: {},
      artifacts: { stdout, stderr, buildLog },
    };
    try {
      if (interrupted)
        throw new RunFailure("timeout", "Controller interrupted");
      result.experiment.environment.dockerVersion = await command([
        "version",
        "--format",
        "{{.Server.Version}}",
      ]);
      result.experiment.environment.imageId = await command([
        "image",
        "inspect",
        manifest.image,
        "--format",
        "{{.Id}}",
      ]);
      const security = [
        "--cpus",
        "1",
        "--memory",
        "256m",
        "--memory-swap",
        "256m",
        "--pids-limit",
        "128",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        "--log-driver",
        "json-file",
        "--log-opt",
        "max-size=1m",
        "--log-opt",
        "max-file=1",
      ];
      try {
        if (interrupted)
          throw new RunFailure("timeout", "Controller interrupted");
        buildAttempted = true;
        await command(
          [
            "run",
            "--pull=never",
            "--name",
            buildName,
            "--network",
            options.buildNetwork ?? "none",
            ...security,
            "--mount",
            `type=bind,src=${workspace},dst=/workspace`,
            "--workdir",
            "/workspace",
            result.experiment.environment.imageId!,
            ...manifest.build,
          ],
          buildTimeout,
          buildLog,
        );
      } catch (error) {
        if (error instanceof RunFailure) throw error;
        if (error instanceof DockerError && error.exitCode === 125)
          throw new RunFailure("infrastructure_failure", String(error));
        const buildState = JSON.parse(await command(["inspect", buildName]))[0]
          .State;
        result.container = {
          exitCode: buildState.ExitCode,
          oomKilled: buildState.OOMKilled,
        };
        throw new RunFailure(
          buildState.OOMKilled ? "resource_limit_violation" : "build_failure",
          String(error),
        );
      }
      await command(["rm", "-f", "--volumes", buildName]);
      buildAttempted = false;
      networkAttempted = true;
      await command(["network", "create", "--internal", network]);
      if (interrupted)
        throw new RunFailure("timeout", "Controller interrupted");
      runtimeAttempted = true;
      await command([
        "run",
        "--pull=never",
        "-d",
        "--name",
        runtimeName,
        "--network",
        network,
        ...security,
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16m",
        "--mount",
        `type=bind,src=${workspace},dst=/workspace,readonly`,
        "--mount",
        `type=bind,src=${fixture},dst=/fixtures,readonly`,
        "--mount",
        `type=bind,src=${state},dst=/data`,
        "--workdir",
        "/workspace",
        "--env",
        "PORT=8080",
        "--env",
        "DATABASE_PATH=/data/candidate.sqlite",
        "--env",
        "FIXTURE_DIR=/fixtures",
        "--env",
        `FAULTY=${options.faulty ? "1" : "0"}`,
        result.experiment.environment.imageId!,
        ...manifest.start,
      ]);
      launched = true;
      const deadline = Date.now() + execution;
      watchdog = setTimeout(() => {
        executionExpired = true;
        void command(["kill", runtimeName]).catch(() => {});
      }, execution);
      const containerInfo = JSON.parse(
        await command(["inspect", runtimeName]),
      )[0];
      const address: unknown =
        containerInfo.NetworkSettings.Networks[network]?.IPAddress;
      if (typeof address !== "string" || isIP(address) !== 4)
        throw new Error("Candidate has no IPv4 address on its isolated bridge");
      const base = `http://${address}:8080`;
      const readyDeadline = Math.min(deadline, Date.now() + readiness);
      let ready = false;
      while (Date.now() < readyDeadline) {
        if (interrupted)
          throw new RunFailure("timeout", "Controller interrupted");
        const inspect = JSON.parse(await command(["inspect", runtimeName]))[0]
          .State as { Running: boolean; OOMKilled: boolean };
        if (!inspect.Running)
          throw new RunFailure(
            inspect.OOMKilled ? "resource_limit_violation" : "startup_failure",
            "Candidate exited before readiness",
          );
        try {
          const response = await fetch(`${base}/health`, {
            signal: AbortSignal.timeout(
              Math.max(1, Math.min(500, readyDeadline - Date.now())),
            ),
            redirect: "error",
          });
          await response.body?.cancel();
          if (response.status === 200) {
            ready = true;
            break;
          }
        } catch {}
        await Bun.sleep(50);
      }
      if (!ready)
        throw new RunFailure(
          Date.now() >= deadline ? "timeout" : "startup_failure",
          "HTTP readiness deadline exceeded",
        );
      let expected: unknown;
      for await (const record of records(join(fixture, "products.jsonl"))) {
        expected = record;
        break;
      }
      result.tests = await smoke(
        base,
        expected,
        AbortSignal.any([
          interruptSignal.signal,
          AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        ]),
      );
      if (executionExpired || interrupted || Date.now() >= deadline)
        throw new RunFailure("timeout", "Execution deadline exceeded");
      const finalState = JSON.parse(await command(["inspect", runtimeName]))[0]
        .State;
      if (!finalState.Running)
        throw new RunFailure(
          finalState.OOMKilled
            ? "resource_limit_violation"
            : "candidate_runtime_failure",
          "Candidate exited during tests",
        );
      if (executionExpired || interrupted || Date.now() >= deadline)
        throw new RunFailure("timeout", "Execution deadline exceeded");
      if (result.tests.some((t) => t.status === "failed"))
        throw new RunFailure(
          "test_assertion_failure",
          "Public smoke assertions failed",
        );
    } catch (error) {
      result.status = {
        state: "failed",
        kind:
          executionExpired || interrupted
            ? "timeout"
            : error instanceof RunFailure
              ? error.kind
              : "infrastructure_failure",
        message: interrupted ? "Controller interrupted" : String(error),
      };
    }
  } finally {
    if (watchdog) clearTimeout(watchdog);
    await Promise.all(pendingStops);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (launched && result) {
      try {
        await command(["stop", "--time", "1", runtimeName]);
        const stateInfo = JSON.parse(await command(["inspect", runtimeName]))[0]
          .State;
        result.container = {
          exitCode: stateInfo.ExitCode,
          oomKilled: stateInfo.OOMKilled,
        };
        if (stateInfo.OOMKilled)
          result.status = {
            state: "failed",
            kind: "resource_limit_violation",
            message: "Container exceeded memory limit",
          };
        const p = Bun.spawn(["docker", "logs", runtimeName], {
          env: { ...process.env },
          stdout: Bun.file(result.artifacts.stdout),
          stderr: Bun.file(result.artifacts.stderr),
        });
        const logTimer = setTimeout(() => p.kill("SIGKILL"), 30000);
        try {
          if ((await p.exited) !== 0)
            cleanupError += "Could not capture Docker logs";
        } finally {
          clearTimeout(logTimer);
        }
      } catch (error) {
        cleanupError += String(error);
      }
    }
    for (const name of [
      ...(runtimeAttempted ? [runtimeName] : []),
      ...(buildAttempted ? [buildName] : []),
    ]) {
      try {
        await command(["rm", "-f", "--volumes", name]);
      } catch (error) {
        if (!String(error).includes("No such container"))
          cleanupError += String(error);
      }
    }
    try {
      if (networkAttempted) await command(["network", "rm", network]);
    } catch (error) {
      if (!String(error).includes("not found")) cleanupError += String(error);
    }
    try {
      await rm(temp, { recursive: true, force: true });
    } catch (error) {
      cleanupError += String(error);
    }
  }
  if (!result) throw new Error("Invalid candidate or fixture input");
  if (cleanupError)
    result.status = {
      state: "failed",
      kind: "infrastructure_failure",
      message: `${result.status.state === "failed" ? `${result.status.message}; ` : ""}Cleanup: ${cleanupError}`,
    };
  result.finishedAt = new Date().toISOString();
  result.correctness = {
    passed: result.tests.filter((t) => t.status === "passed").length,
    failed: result.tests.filter((t) => t.status === "failed").length,
  };
  const times = result.tests
    .flatMap((t) => (t.latencyMs === undefined ? [] : [t.latencyMs]))
    .sort((a, b) => a - b);
  if (times.length)
    result.metrics.latencyMs = {
      min: times[0]!,
      median: times[Math.floor(times.length / 2)]!,
      max: times[times.length - 1]!,
    };
  await saveResult(runs, result);
  return result;
}
