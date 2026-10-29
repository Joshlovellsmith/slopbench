// Docker verification controller for the Bun reference; the HTTP suite is language independent.
// Never runs candidate-defined build/start commands on the host.
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, relative, resolve } from "node:path";
import { verifyContract } from "../../src/contract";
import { verify } from "../../src/fixtures";
import { readJUnit } from "../../src/harness/junit";
import { command, RunFailure } from "../../src/runner";
import { snapshot } from "../../src/runner/source";
import { candidateSchema, type Result } from "../../src/schemas";
import { saveResult } from "../../src/storage";
import {
  fixtureBindingAudit,
  type Instance,
  isolationAudit,
  wireAudit,
} from "./reference-audit";

const runId = randomUUID(),
  prefix = `sb-r0-${runId}`;
const artifactDir = resolve("runs", runId),
  temp = await mkdtemp(join(tmpdir(), "slopbench-round0-"));
await mkdir(artifactDir, { recursive: true });
const domains = [
  "catalogue",
  "inventory",
  "orders",
  "analytics",
  "import",
  "simulation",
];
const instances = new Map<string, Instance>();
const attempted = new Set<string>();
const networks = new Set<string>();
let lock: Database | undefined,
  controller: ReturnType<typeof Bun.serve> | undefined;
let child: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  child?.kill();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
let result: Result | undefined;
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
async function ready(url: string, name: string) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (interrupted) throw new RunFailure("timeout", "Controller interrupted");
    const state = JSON.parse(await command(["inspect", name]))[0].State;
    if (!state.Running)
      throw new RunFailure(
        state.OOMKilled ? "resource_limit_violation" : "startup_failure",
        `${name} exited before readiness`,
      );
    try {
      const r = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (r.status === 200 && (await r.json()).status === "ok") return;
    } catch {}
    await Bun.sleep(50);
  }
  throw new RunFailure("startup_failure", `${name} readiness timeout`);
}

try {
  const candidatePath = await realpath(
    process.argv[2] ?? "examples/round0-reference",
  );
  const repositoryRelative = relative(candidatePath, resolve("."));
  if (
    repositoryRelative === "" ||
    (!repositoryRelative.startsWith("..") &&
      !repositoryRelative.startsWith("/"))
  )
    throw new Error("Candidate workspace must not contain the repository root");
  const workspace = join(temp, "workspace"),
    sourceHash = await snapshot(candidatePath, workspace);
  const manifest = candidateSchema.parse(
    await Bun.file(join(workspace, "candidate.json")).json(),
  );
  const fixture = await verify("benchmark/fixtures/public");
  await verify("benchmark/fixtures/empty");
  let imageId: string;
  const stdout = join(artifactDir, "public.stdout.log"),
    stderr = join(artifactDir, "public.stderr.log"),
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
      benchmark: { id: "slopshop-round-00", version: "0.1.0" },
      suite: { id: "round-00-public", version: "0.1.0" },
      candidate: {
        id: manifest.id,
        sourceHash,
        language: manifest.language,
        runtime: manifest.runtime,
      },
      development: {},
      fixture,
      environment: {
        platform: platform(),
        kernelRelease: release(),
        architecture: arch(),
        cpuModel: cpus()[0]?.model ?? "unknown",
        logicalCpuCount: cpus().length,
        hostMemoryBytes: totalmem(),
        controllerRuntime: Bun.version,
        image: manifest.image,
        cpuLimit: 1,
        memoryLimitBytes: 268435456,
        executionTimeoutMs: 180000,
        readinessTimeoutMs: 10000,
        buildTimeoutMs: 60000,
        buildNetwork: "none",
      },
    },
    status: {
      state: "failed",
      kind: "infrastructure_failure",
      message: "Acceptance did not finish",
    },
    tests: [],
    correctness: { passed: 0, failed: 0 },
    metrics: {},
    container: {},
    artifacts: { stdout, stderr, buildLog },
  };
  result.experiment.benchmark.contractHash = (await verifyContract()).sha256;
  result.experiment.environment.dockerVersion = await command([
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  imageId = await command([
    "image",
    "inspect",
    manifest.image,
    "--format",
    "{{.Id}}",
  ]);
  result.experiment.environment.imageId = imageId;
  const build = `${prefix}-build`;
  attempted.add(build);
  try {
    await command(
      [
        "run",
        "--pull=never",
        "--name",
        build,
        "--network",
        "none",
        ...security,
        "--mount",
        `type=bind,src=${workspace},dst=/workspace`,
        "--workdir",
        "/workspace",
        imageId,
        ...manifest.build,
      ],
      60000,
      buildLog,
    );
  } catch (error) {
    throw new RunFailure("build_failure", String(error));
  }
  await command(["rm", "-f", "--volumes", build]);
  attempted.delete(build);
  for (const domain of [...domains, "empty"]) {
    if (interrupted) throw new RunFailure("timeout", "Controller interrupted");
    const data = join(temp, domain),
      fixturePath = join(temp, `${domain}-fixtures`),
      name = `${prefix}-${domain}`,
      network = `${prefix}-${domain}-net`;
    await command(["network", "create", "--internal", network]);
    networks.add(network);
    await mkdir(data);
    await chmod(data, 0o700);
    await mkdir(fixturePath);
    for (const file of ["manifest.json", "products.jsonl", "customers.jsonl"])
      await copyFile(
        resolve(
          `benchmark/fixtures/${domain === "empty" ? "empty" : "public"}`,
          file,
        ),
        join(fixturePath, file),
      );
    attempted.add(name);
    await command([
      "run",
      "--pull=never",
      "-d",
      "--name",
      name,
      "--network",
      network,
      ...security,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m",
      "--mount",
      `type=bind,src=${workspace},dst=/workspace,readonly`,
      "--mount",
      `type=bind,src=${fixturePath},dst=/fixtures,readonly`,
      "--mount",
      `type=bind,src=${data},dst=/data`,
      "--workdir",
      "/workspace",
      "--env",
      "PORT=8080",
      "--env",
      "FIXTURE_DIR=/fixtures",
      "--env",
      "DATABASE_PATH=/data/candidate.sqlite",
      imageId,
      ...manifest.start,
    ]);
    const inspect = JSON.parse(await command(["inspect", name]))[0];
    const address = inspect.NetworkSettings.Networks[network]
      .IPAddress as string;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(address))
      throw new Error("Missing isolated candidate IPv4 address");
    const instance = {
      name,
      data,
      url: `http://${address}:8080`,
      fixture: fixturePath,
      network,
    };
    instances.set(domain, instance);
    await ready(instance.url, name);
  }
  const orders = instances.get("orders")!;
  controller = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      try {
        switch (new URL(request.url).pathname) {
          case "/restart":
            if (lock) throw new Error("Cannot restart during injected fault");
            await command(["restart", "--time", "3", orders.name]);
            await ready(orders.url, orders.name);
            break;
          case "/storage-failure-on":
            if (lock) throw new Error("Fault already active");
            lock = new Database(join(orders.data, "candidate.sqlite"), {
              strict: true,
            });
            lock.exec("PRAGMA busy_timeout=1000; BEGIN IMMEDIATE");
            break;
          case "/storage-failure-off":
            if (lock) {
              lock.exec("ROLLBACK");
              lock.close();
              lock = undefined;
            }
            break;
          default:
            return new Response(null, { status: 404 });
        }
        return new Response(null, { status: 204 });
      } catch (error) {
        console.error(error);
        return new Response("Controller operation failed", { status: 500 });
      }
    },
  });
  const targets = Object.fromEntries(
    domains.map((domain) => [
      domain,
      {
        url: instances.get(domain)!.url,
        ...(["catalogue", "analytics", "simulation"].includes(domain)
          ? { emptyUrl: instances.get("empty")!.url }
          : {}),
        ...(domain === "orders"
          ? { controlUrl: `http://127.0.0.1:${controller!.port}` }
          : {}),
      },
    ]),
  );
  const plan = join(artifactDir, "targets.json"),
    junit = join(artifactDir, "public.junit.xml");
  await Bun.write(plan, JSON.stringify(targets, null, 2));
  const env: Record<string, string | undefined> = {
    ...process.env,
    ROUND0_TARGETS: plan,
  };
  delete env.ROUND0_DOMAIN;
  delete env.ROUND0_BASE_URL;
  delete env.ROUND0_EMPTY_URL;
  delete env.ROUND0_CONTROL_URL;
  child = Bun.spawn(
    [
      process.execPath,
      "test",
      "benchmark/tests/public",
      "--reporter=junit",
      `--reporter-outfile=${junit}`,
    ],
    {
      env,
      stdout: Bun.file(join(artifactDir, "public.stdout.log")),
      stderr: Bun.file(join(artifactDir, "public.stderr.log")),
    },
  );
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    child?.kill();
  }, 180000);
  let code: number;
  try {
    code = await child.exited;
  } finally {
    clearTimeout(timer);
  }
  if (expired || interrupted)
    throw new RunFailure(
      "timeout",
      "Acceptance execution timed out or was interrupted",
    );
  result.tests = readJUnit(await Bun.file(junit).text(), 39);
  if (code !== 0 || result.tests.some((t) => t.status === "failed"))
    throw new RunFailure(
      "test_assertion_failure",
      "Public acceptance assertions failed; see JUnit and public.stderr.log",
    );
  const canary = join(temp, "evaluator-private-canary");
  await Bun.write(canary, "controller-only test canary");
  const isolation = await isolationAudit(
    instances.get("catalogue")!,
    canary,
    controller!.port!,
    `${instances.get("inventory")!.url}/health`,
  );
  const wire = await wireAudit(instances.get("inventory")!.url);
  const binding = await fixtureBindingAudit(instances.get("empty")!);
  await ready(instances.get("empty")!.url, instances.get("empty")!.name);
  await Bun.write(
    join(artifactDir, "supplemental-audit.json"),
    JSON.stringify({ isolation, binding, wire }, null, 2),
  );
  // Audit SQLite generically, without inspecting candidate table layouts.
  const audits: Record<string, unknown> = {};
  for (const [domain, instance] of instances) {
    const state = JSON.parse(await command(["inspect", instance.name]))[0];
    if (!state.State.Running)
      throw new RunFailure(
        state.State.OOMKilled
          ? "resource_limit_violation"
          : "candidate_runtime_failure",
        `${domain} exited during acceptance`,
      );
    const dbPath = join(instance.data, "candidate.sqlite");
    const header = new Uint8Array(
      await Bun.file(dbPath).slice(0, 16).arrayBuffer(),
    );
    if (Buffer.from(header).toString() !== "SQLite format 3\u0000")
      throw new Error(`${domain} database is not SQLite`);
    const audit = new Database(dbPath, { readonly: true });
    try {
      const integrity = audit.query("PRAGMA integrity_check").all();
      if (JSON.stringify(integrity) !== '[{"integrity_check":"ok"}]')
        throw new Error(`${domain} SQLite integrity failed`);
      audits[domain] = {
        integrity,
        mounts: state.Mounts,
        config: {
          user: state.Config.User,
          readOnly: state.HostConfig.ReadonlyRootfs,
          capDrop: state.HostConfig.CapDrop,
          network: state.HostConfig.NetworkMode,
          ports: state.HostConfig.PortBindings,
        },
      };
    } finally {
      audit.close();
    }
  }
  await Bun.write(
    join(artifactDir, "audit.json"),
    JSON.stringify(audits, null, 2),
  );
  result.status = { state: "passed" };
} catch (error) {
  console.error(error);
  if (result)
    result.status = {
      state: "failed",
      kind: error instanceof RunFailure ? error.kind : "infrastructure_failure",
      message: String(error),
    };
  process.exitCode =
    error instanceof RunFailure && error.kind === "test_assertion_failure"
      ? 1
      : 2;
} finally {
  child?.kill();
  if (lock) {
    lock.exec("ROLLBACK");
    lock.close();
  }
  controller?.stop(true);
  const cleanupErrors: string[] = [];
  for (const [domain, instance] of instances) {
    try {
      await command(["stop", "--time", "3", instance.name]);
      const p = Bun.spawn(["docker", "logs", instance.name], {
        stdout: Bun.file(join(artifactDir, `${domain}.stdout.log`)),
        stderr: Bun.file(join(artifactDir, `${domain}.stderr.log`)),
      });
      if ((await p.exited) !== 0)
        cleanupErrors.push(`Log capture failed for ${domain}`);
      const state = JSON.parse(await command(["inspect", instance.name]))[0]
        .State;
      if (state.OOMKilled) cleanupErrors.push(`${domain} OOM`);
      if (state.ExitCode !== 0)
        cleanupErrors.push(`${domain} exited ${state.ExitCode}`);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  for (const name of attempted) {
    try {
      await command(["rm", "-f", "--volumes", name]);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  for (const network of networks) {
    try {
      await command(["network", "rm", network]);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  try {
    await rm(temp, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(String(error));
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  if (result) {
    if (cleanupErrors.length) {
      result.status = {
        state: "failed",
        kind: "infrastructure_failure",
        message: cleanupErrors.join("; "),
      };
      process.exitCode = 2;
    }
    result.finishedAt = new Date().toISOString();
    result.correctness = {
      passed: result.tests.filter((t) => t.status === "passed").length,
      failed: result.tests.filter((t) => t.status === "failed").length,
    };
    const path = await saveResult("runs", result);
    await Bun.write(
      join(artifactDir, "cleanup.json"),
      JSON.stringify(
        {
          removedContainers: [...attempted],
          removedNetworks: [...networks],
          removedTemporaryDirectory: temp,
          errors: cleanupErrors,
        },
        null,
        2,
      ),
    );
    console.log(
      `${result.status.state}: ${result.correctness.passed} passed, ${result.correctness.failed} failed; ${path}`,
    );
  }
}
