import { readFile } from "node:fs/promises";
import { verify } from "../../src/fixtures";

const domains = [
  "catalogue",
  "inventory",
  "orders",
  "analytics",
  "import",
  "simulation",
];
const help = `Round 0 public HTTP tests (a conforming application must be supplied separately)
  bun run round0:test --discover
  bun run round0:test --domain catalogue --url http://CANDIDATE:8080 [--empty-url URL]
  bun run round0:test --domain orders --url URL [--control-url CONTROLLER_URL]
  bun run round0:test --all --targets benchmark-targets.json
Each domain needs a fresh seed-12345 public 12/4 database. See benchmark/tests/README.md.`;
try {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (
      ![
        "--discover",
        "--all",
        "--domain",
        "--url",
        "--empty-url",
        "--control-url",
        "--targets",
        "--help",
      ].includes(key) ||
      flags.has(key)
    )
      throw new Error(`Unknown/duplicate flag ${key}`);
    if (["--discover", "--all", "--help"].includes(key)) flags.set(key, "true");
    else {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing ${key} value`);
      flags.set(key, value);
    }
  }
  if (flags.has("--help")) {
    console.log(help);
    process.exit(0);
  }
  const env = { ...process.env };
  for (const key of [
    "ROUND0_TARGETS",
    "ROUND0_DOMAIN",
    "ROUND0_BASE_URL",
    "ROUND0_EMPTY_URL",
    "ROUND0_CONTROL_URL",
  ])
    delete env[key];
  let path = "benchmark/tests/public";
  function url(value: unknown) {
    if (typeof value !== "string")
      throw new Error("Target URL must be a string");
    const u = new URL(value);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw new Error(`Invalid target URL ${value}`);
    return u.toString().replace(/\/$/, "");
  }
  if (flags.has("--discover")) {
    if (flags.size !== 1)
      throw new Error("--discover cannot be combined with live target flags");
    console.log(
      "Discovery/oracle mode: no candidate HTTP assertions will execute.",
    );
  } else if (flags.has("--all")) {
    if (!flags.has("--targets") || flags.size !== 2)
      throw new Error("--all requires only --targets FILE");
    const file = flags.get("--targets")!;
    const plan = JSON.parse(await readFile(file, "utf8")) as Record<
      string,
      { url: string; emptyUrl?: string; controlUrl?: string }
    >;
    const seen = new Set<string>();
    for (const domain of domains) {
      const target = plan[domain];
      if (!target) throw new Error(`Missing ${domain} target`);
      const base = url(target.url);
      if (seen.has(base))
        throw new Error(
          "Each domain requires a separate fresh candidate database/URL",
        );
      seen.add(base);
      for (const key of ["emptyUrl", "controlUrl"] as const)
        if (target[key]) url(target[key]);
    }
    if (Object.keys(plan).some((k) => !domains.includes(k)))
      throw new Error("Unknown domain in target plan");
    env.ROUND0_TARGETS = file;
  } else {
    const domain = flags.get("--domain");
    if (
      !domain ||
      !domains.includes(domain) ||
      !flags.has("--url") ||
      flags.has("--targets")
    )
      throw new Error(help);
    env.ROUND0_DOMAIN = domain;
    env.ROUND0_BASE_URL = url(flags.get("--url"));
    if (flags.has("--empty-url"))
      env.ROUND0_EMPTY_URL = url(flags.get("--empty-url"));
    if (flags.has("--control-url"))
      env.ROUND0_CONTROL_URL = url(flags.get("--control-url"));
    path = `benchmark/tests/public/${domain}.test.ts`;
  }
  await verify("benchmark/fixtures/public");
  await verify("benchmark/fixtures/empty");
  const child = Bun.spawn([process.execPath, "test", path], {
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
} catch (error) {
  console.error(String(error));
  process.exitCode = 2;
}
