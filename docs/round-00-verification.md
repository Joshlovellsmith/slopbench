# Round 0 design verification (Task 2 historical record)

Task 3 subsequently implemented the reference and passed all 39 cases without
skips. See [current verification and freeze evidence](task-3-verification.md).
The statements and counts below describe the earlier design-only baseline.

Verified with Bun 1.4.4, TypeScript 5.9.3, Python 3.14.4, Redocly CLI 2.72.0,
Ajv 8.20.0 and ajv-formats 3.0.1. No conforming Round 0 application exists in this
repository. Results below are infrastructure/specification evidence, not a
claim that all Round 0 HTTP acceptance cases pass.

## Commands actually executed

* `bun install --frozen-lockfile`: succeeds with the committed dependency lock.
* `bun run round0:generate-openapi`: generated the OpenAPI 3.1.1 artifact using
  shared v1 product fields and Round 0 bounds/additions.
* `bun run round0:fixtures`: generated only the tiny 12-product/4-customer and
  zero/zero public fixtures, using the existing seed-12345 v1 generator.
* `bun run round0:traceability`: generated the requirement index and matrix.
* `bun run round0:check`: passes OpenAPI generation-freshness checks, all
  requirement/test/workload links, Redocly validation (no warnings), and the
  independent Python oracle. All 11 API operations have prose/requirement links.
* `bun run round0:test --discover`: 39 public cases discovered across six domains;
  one numerical-oracle test passes, 38 HTTP cases explicitly skip. Five of those
  live cases additionally require empty-fixture or external lifecycle targets.
* `bun test tests/round0-infrastructure.test.ts`: five tests pass. These verify
  fixture/manifest byte reproducibility including empty data, response-schema
  acceptance/rejection, all success shapes, numerical analytical examples and
  the small-oracle guard, plus the HTTP adapter's positive and diagnostic paths
  against fixed response fixtures. The response fixture is not SlopShop.
* `bun run format`, `bun run lint`, `bun run typecheck`: pass.
* `bun test`: 14 pass, 40 skip (38 Round 0 HTTP cases and two opt-in Docker
  cases), zero failures.
* `SLOPBENCH_DOCKER_TEST=1 bun test`: 16 pass, 38 skip, zero failures. The live
  Docker passes are the existing Milestone 1 smoke/isolation regression tests,
  not a Round 0 application. Container/network lists were empty afterward.

The numerical artifact contains ten pinned random words and seven complete
simulation cases, independently generated/checked with Python arbitrary integers
and checked using a TypeScript oracle with 32-bit words and BigInt rounding.
The cases include the actual Small profile, a hand-checked day-one arrival,
zero demand, high unsigned seed/coordinates, exact half-up rounding, large rounding
intermediates and multiple product/scenario trajectories. A 100,000-logical-day
oracle guard prevents accidental Medium/Large execution. Neither a Medium/Large
simulation nor a saturation campaign was run.

## Consistency and ambiguity review

The checker scans TypeScript test registrations, rejects unmapped/duplicate test
IDs, verifies all 32 published requirement groups have public cases and a proposed
private/workload strategy, and rejects stale generated traceability. OpenAPI
response schemas are also exercised with explicit valid and invalid fixtures.
These mechanical checks complement manual review of endpoint fields, status codes,
bounds/defaults, missing/null behavior, date precision/range, duplicate handling,
sort ties, arithmetic, error precedence, import framing and concurrency semantics.
They do not automatically prove all prose/schema semantics equivalent.

Review fixes included rejecting final-newline identifiers/SKUs (regex `$` edge),
explicit category/product revenue key schemas, mandatory discontinued-stock
adjustability, parsed manifest identity (not whitespace equality), normalized
candidate URLs, atomic adjustment return-value checks, and explicit distinctions
between HTTP framing errors and application errors. Benchmark fixture files are
excluded from formatting after a reproducibility test caught a manifest rewrite;
they were regenerated to the original canonical bytes and rechecked.

No language-specific candidate adapter, database table schema, reset endpoint or
application numeric representation is required. Binary64 is a defined wire-number
normalization rule (including negative-zero normalization); subsequent arithmetic must have exact integer semantics and
may use any provably equivalent representation/decomposition. All interface
assertions use HTTP; optional restart/storage-failure operations are against a
separate evaluator controller, never the candidate. SQLite engine attestation is
a separate environment audit, not something HTTP alone can prove.

## Remaining verification and research risks

Full live acceptance, restart/commit-failure injection, large-body memory behavior
and performance scaling remain unverified until a conforming implementation and
external lifecycle environment are supplied. Medium/Large vectors for timed
campaigns must be independently checked outside timing; this task supplies small
numerical examples only. Traceability entries for private tests are proposals,
not executable hidden tests.

Before freezing a research release, review the explicit binary64 input convention,
MAX_SAFE aggregate policy, 2 GiB atomic import/storage budget, counter-hash/modulo
statistical properties, workload deadlines and inherited v1 category correlation.
None is left as an undefined behavior in the current contract; they are design
policies/experimental representativeness risks. No application, hidden evaluator,
load generator, dashboard, orchestration or future round was implemented.
