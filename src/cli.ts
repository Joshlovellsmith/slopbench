import { generate, profiles, verify } from "./fixtures";
import { evaluate } from "./runner";
import { latest } from "./storage";

const help = `SlopBench milestone 1
  fixtures generate [--profile small|medium|large] [--seed 12345] [--out fixtures/small]
  fixtures verify [--fixture fixtures/small]
  evaluate --candidate PATH [--fixture PATH] [--runs runs] [--readiness-timeout-ms 10000]
           [--execution-timeout-ms 20000] [--build-timeout-ms 60000] [--build-network none|default]
  report --latest [--runs runs]
  self-test [--fixture fixtures/small] [--runs runs]
Images must already be available locally. See docs/milestone-1.md.`;
function summary(r: Awaited<ReturnType<typeof evaluate>>) {
  return `${r.runId} ${r.experiment.candidate.id}: ${r.status.state}${r.status.state === "failed" ? ` (${r.status.kind}): ${r.status.message}` : ""}\nTests: ${r.correctness.passed} passed, ${r.correctness.failed} failed\n${r.tests
    .filter((t) => t.status === "failed")
    .map((t) => `${t.name}: ${t.message}`)
    .join("\n")}`;
}
try {
  const args = process.argv.slice(2);
  const command = args.shift();
  const sub = command === "fixtures" ? args.shift() : undefined;
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (key === "--latest" || key === "--help") {
      flags.set(key, "true");
      continue;
    }
    if (!key.startsWith("--") || !args[i + 1] || args[i + 1]!.startsWith("--"))
      throw new Error(`Expected value for ${key}`);
    if (flags.has(key)) throw new Error(`Duplicate argument ${key}`);
    flags.set(key, args[++i]!);
  }
  const allowed =
    command === "fixtures"
      ? sub === "generate"
        ? ["--profile", "--seed", "--out"]
        : ["--fixture"]
      : command === "evaluate"
        ? [
            "--candidate",
            "--fixture",
            "--runs",
            "--readiness-timeout-ms",
            "--execution-timeout-ms",
            "--build-timeout-ms",
            "--build-network",
          ]
        : command === "self-test"
          ? ["--fixture", "--runs"]
          : ["--latest", "--runs", "--help"];
  for (const key of flags.keys())
    if (key !== "--help" && !allowed.includes(key))
      throw new Error(`Unknown argument ${key}`);
  const get = (name: string, fallback: string) =>
    flags.get(`--${name}`) ?? fallback;
  const number = (name: string, fallback: number) => {
    const n = Number(get(name, String(fallback)));
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error(`--${name} must be a nonnegative integer`);
    return n;
  };
  if (!command || command === "--help" || flags.has("--help"))
    console.log(help);
  else if (command === "fixtures" && sub === "generate") {
    const profile = get("profile", "small");
    if (!Object.hasOwn(profiles, profile))
      throw new Error(`Unknown profile ${profile}`);
    console.log(
      await generate(
        get("out", `fixtures/${profile}`),
        number("seed", 12345),
        profiles[profile as keyof typeof profiles],
      ),
    );
  } else if (command === "fixtures" && sub === "verify")
    console.log(await verify(get("fixture", "fixtures/small")));
  else if (command === "report") {
    console.log(summary(await latest(get("runs", "runs"))));
  } else if (command === "evaluate") {
    const candidate = flags.get("--candidate");
    if (!candidate) throw new Error("--candidate PATH is required");
    const buildNetwork = get("build-network", "none");
    if (buildNetwork !== "none" && buildNetwork !== "default")
      throw new Error("--build-network must be none or default");
    const result = await evaluate({
      candidate,
      fixture: get("fixture", "fixtures/small"),
      runs: get("runs", "runs"),
      readinessTimeoutMs: number("readiness-timeout-ms", 10000),
      executionTimeoutMs: number("execution-timeout-ms", 20000),
      buildTimeoutMs: number("build-timeout-ms", 60000),
      buildNetwork,
    });
    console.log(summary(result));
    process.exitCode =
      result.status.state === "passed"
        ? 0
        : result.status.kind === "test_assertion_failure"
          ? 1
          : 2;
  } else if (command === "self-test") {
    for (const faulty of [false, true]) {
      const r = await evaluate({
        candidate: "examples/reference",
        fixture: get("fixture", "fixtures/small"),
        runs: get("runs", "runs"),
        faulty,
      });
      console.log(summary(r));
      if (
        faulty
          ? !(
              r.status.state === "failed" &&
              r.status.kind === "test_assertion_failure"
            )
          : r.status.state !== "passed"
      )
        throw new Error(
          "Self-test failed; Docker and its locally available image are required",
        );
    }
    console.log(
      "Self-test passed: reference succeeds and faulty mode fails assertions.",
    );
  } else throw new Error(`Unknown command\n${help}`);
} catch (error) {
  console.error(String(error));
  process.exitCode = 2;
}
