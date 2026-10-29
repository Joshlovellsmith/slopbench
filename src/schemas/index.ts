import { z } from "zod";
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const measurement = z.number().finite().nonnegative();
export const productSchema = z
  .object({
    id: z.string(),
    sku: z.string(),
    name: z.string(),
    category: z.enum(["books", "home", "electronics", "clothing"]),
    priceMinor: count,
    inventory: count,
    status: z.enum(["active", "discontinued"]),
    popularityWeight: z.number().int().positive(),
  })
  .strict();
export const customerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    registeredAt: z.iso.datetime(),
    active: z.boolean(),
  })
  .strict();
export const fixtureManifestSchema = z
  .object({
    schemaVersion: z.literal("1"),
    generatorVersion: z.literal("1"),
    seed: z.number().int().min(0).max(4294967295),
    counts: z.object({ products: count, customers: count }).strict(),
    files: z
      .object({ "products.jsonl": hash, "customers.jsonl": hash })
      .strict(),
  })
  .strict();
export const candidateSchema = z
  .object({
    schemaVersion: z.literal("1"),
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    language: z.string().min(1),
    runtime: z.string().min(1),
    image: z.string().min(1),
    build: z.array(z.string()).min(1),
    start: z.array(z.string()).min(1),
  })
  .strict();
export const failureKind = z.enum([
  "build_failure",
  "startup_failure",
  "infrastructure_failure",
  "timeout",
  "test_assertion_failure",
  "candidate_runtime_failure",
  "resource_limit_violation",
]);
export const outcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("passed"),
    name: z.string(),
    // A case may span many requests; these are present only for a single measured request.
    latencyMs: measurement.optional(),
    httpStatus: count.optional(),
    durationMs: measurement.optional(),
  }),
  z.object({
    status: z.literal("failed"),
    name: z.string(),
    latencyMs: measurement.optional(),
    httpStatus: count.optional(),
    durationMs: measurement.optional(),
    message: z.string(),
  }),
]);
export const experimentSchema = z.object({
  benchmark: z.object({
    id: z.string(),
    version: z.string(),
    contractHash: hash.optional(),
  }),
  candidate: z.object({
    id: z.string(),
    sourceHash: hash,
    language: z.string(),
    runtime: z.string(),
  }),
  development: z.object({
    model: z
      .object({ provider: z.string(), name: z.string(), version: z.string() })
      .optional(),
    harness: z
      .object({
        name: z.string(),
        version: z.string(),
        configuration: z.record(z.string(), z.json()).optional(),
      })
      .optional(),
    budget: z
      .object({
        wallTimeSeconds: measurement.optional(),
        tokens: count.optional(),
        costUsd: measurement.optional(),
      })
      .optional(),
    usage: z
      .object({
        wallTimeSeconds: measurement.optional(),
        inputTokens: count.optional(),
        outputTokens: count.optional(),
        costUsd: measurement.optional(),
      })
      .optional(),
  }),
  fixture: fixtureManifestSchema,
  environment: z.object({
    platform: z.string(),
    kernelRelease: z.string().optional(),
    cpuModel: z.string().optional(),
    logicalCpuCount: count.optional(),
    hostMemoryBytes: count.optional(),
    architecture: z.string(),
    controllerRuntime: z.string(),
    dockerVersion: z.string().optional(),
    image: z.string(),
    imageId: z.string().optional(),
    cpuLimit: measurement,
    memoryLimitBytes: count,
    executionTimeoutMs: measurement,
    readinessTimeoutMs: measurement,
    buildTimeoutMs: measurement,
    buildNetwork: z.enum(["none", "default"]),
  }),
  suite: z.object({ id: z.string(), version: z.string() }),
});
export const resultSchema = z
  .object({
    schemaVersion: z.literal("1"),
    runId: z.uuid(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    experiment: experimentSchema,
    status: z.discriminatedUnion("state", [
      z.object({ state: z.literal("passed") }),
      z.object({
        state: z.literal("failed"),
        kind: failureKind,
        message: z.string(),
      }),
    ]),
    tests: z.array(outcomeSchema),
    correctness: z.object({ passed: count, failed: count }),
    metrics: z.object({
      latencyMs: z
        .object({ min: measurement, median: measurement, max: measurement })
        .optional(),
      throughputRequestsPerSecond: measurement.optional(),
      peakMemoryBytes: count.optional(),
      cpuTimeSeconds: measurement.optional(),
      cpuUtilizationRatio: measurement.optional(),
    }),
    container: z.object({
      exitCode: z.number().int().optional(),
      oomKilled: z.boolean().optional(),
    }),
    artifacts: z.object({
      stdout: z.string(),
      stderr: z.string(),
      buildLog: z.string(),
    }),
  })
  .strict()
  .superRefine((r, ctx) => {
    const passed = r.tests.filter((t) => t.status === "passed").length;
    const failed = r.tests.length - passed;
    if (
      r.correctness.passed !== passed ||
      r.correctness.failed !== failed ||
      (r.status.state === "passed" && (failed > 0 || passed === 0))
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent correctness summary",
      });
  });
export type Product = z.infer<typeof productSchema>;
export type Result = z.infer<typeof resultSchema>;
export type FailureKind = z.infer<typeof failureKind>;
export type Outcome = z.infer<typeof outcomeSchema>;
