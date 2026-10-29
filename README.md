# SlopBench

**A benchmark for AI-generated software across programming languages.**

SlopBench investigates how programming language choice affects the ability of AI coding agents to produce correct, performant, resource-efficient and maintainable software.

Rather than evaluating isolated algorithmic puzzles, SlopBench asks agents to build and progressively extend a realistic HTTP API application under controlled experimental conditions.

The same application specification is implemented in different languages, then evaluated using independent correctness, regression and performance tests.

## Research questions

SlopBench aims to answer:

1. Which programming languages produce the most correct implementations when an AI agent is given the same task and resource budget?
2. Which languages allow agents to achieve correctness with the least inference expenditure and elapsed development time?
3. How do the resulting implementations compare in runtime performance, memory consumption, CPU efficiency and storage overhead?
4. How well do implementations survive incremental requirements, architectural changes and growing codebase complexity?
5. How much does an agent's familiarity with a programming language affect its performance?
6. Do historically ergonomic languages retain their advantages when software is predominantly authored by AI agents?

The objective is empirical comparison, not advocacy for a particular language, framework or model.

## Experimental model

Each experiment combines:

- A programming language.
- A specific AI model and agent harness.
- A versioned application specification.
- A controlled development budget.
- A reproducible execution environment.
- Three independent evaluation suites.

Early experiments will hold the model and agent harness constant while varying the programming language.

Future experiments may compare models, harnesses, unfamiliar languages and alternative implementation strategies.

### Benchmark application

The initial application, provisionally named **SlopShop**, is a SQLite-backed HTTP API covering:

- Product catalogue management and querying.
- Inventory operations.
- Order processing.
- Transactional business operations.
- Sales analytics.
- Bulk data processing.

The application will grow through incremental benchmark rounds that introduce new requirements while preserving existing functionality.

The specification defines externally observable behaviour, not internal implementation architecture.

Candidates may select their own frameworks, libraries, algorithms and architectural patterns within published experimental constraints.

Initial languages are TypeScript, Go and Python. The framework must accommodate additional languages without requiring changes to the test suites.

## Evaluation suites

### 1. Public test suite

Visible to the coding agent during development.

Provides executable acceptance tests, examples and feedback on compliance with the published specification.

The public suite should be sufficiently useful for an agent to develop and debug a complete implementation.

### 2. Hidden test suite

Executed by an independent evaluator, ideally on a separate machine.

Tests specification compliance, edge cases, transactional integrity, persistence, concurrency invariants and regressions.

Hidden tests must never rely on unspecified behaviour.

Every hidden assertion must correspond to a published requirement.

The hidden evaluator lives in a separate private repository and must not be mounted into candidate execution environments.

### 3. Saturation performance suite

Measures runtime efficiency under controlled workloads.

Metrics include:

- Successful throughput.
- Latency distributions, including p50, p95 and p99.
- Maximum sustainable throughput under a defined latency and error budget.
- Peak and steady-state memory consumption.
- CPU utilisation and CPU time per successful operation.
- Storage utilisation and disk I/O.
- Startup and build performance.

Performance workloads should use a controlled arrival process and account for coordinated omission.

Correctness and performance are reported separately. Incorrect implementations cannot qualify for performance rankings.

Workload methodology should be public, even when evaluation data is private.

## Deterministic data

SlopBench uses synthetic, versioned data generated using deterministic algorithms.

Fixture generation must be reproducible across machines and runtime versions.

Each generated dataset is identified by:

- Fixture schema version.
- Generator version.
- Explicit seed.
- Record counts.
- Content hash.

The generator should eventually support multiple dataset sizes and realistic distributions, including skewed product popularity and boundary conditions.

Generated datasets must not rely on the current time, uncontrolled randomness, locale-dependent formatting or platform-dependent iteration order.

Once a benchmark fixture version is published, its contents are immutable.

Data generation is part of benchmark infrastructure, not a task assigned to candidate agents.

## Experimental controls

Every recorded run must identify:

- Benchmark specification version.
- Test suite version.
- Fixture version and hash.
- Candidate source revision/hash.
- Programming language and runtime version.
- Model and agent harness version.
- Agent configuration and development budget.
- Execution host and resource limits.
- Dependency versions where available.
- Test configuration and measurement methodology.

Runs should be repeatable and independently auditable.

Experiments should include multiple independent attempts and report uncertainty rather than relying on single-run rankings.

The development environment and evaluation environment are conceptually separate.

Candidate applications must run within resource-constrained isolation boundaries. Evaluator secrets and hidden tests must never be accessible to candidates.

## Architecture

The proposed implementation consists of:

**Benchmark controller**

A TypeScript/Bun CLI that manages fixture generation, candidate execution, test orchestration, measurement collection and reports.

**Public benchmark package**

Published specifications, deterministic fixtures, visible tests and candidate execution instructions.

**Private evaluator**

Hidden correctness tests, performance workloads and scoring logic, maintained separately from the public repository.

**Candidate execution environment**

Disposable, isolated containers running language-specific implementations behind a common HTTP interface.

**Results store**

Structured JSON artifacts and SQLite metadata for comparing runs and producing future dashboards.

A Go-based load generator is a candidate for the saturation suite. Its selection should be justified by measurement quality, reproducibility and simplicity rather than assumed performance superiority.

## Benchmark progression

The experiment advances through versioned rounds.

- **Round 0:** Implement the initial HTTP API.
- **Round 1:** Introduce discounts and promotions.
- **Round 2:** Add inventory reservations and expiration.
- **Round 3:** Introduce large-scale data processing and analytics.
- **Round 4:** Introduce concurrency, idempotency and additional transactional requirements.

These rounds are provisional.

Candidates retain their implementations between rounds. Future requirements must remain unavailable until the relevant round begins.

Both initial implementation quality and subsequent change resilience are measured.

## Engineering principles

1. **Reproducibility first.** Identical inputs must generate identical fixtures and evaluation conditions wherever technically feasible.
2. **Specification over implementation.** Test externally observable behaviour rather than prescribed internal architecture.
3. **Independent verification.** Candidate code cannot inspect, modify or influence hidden evaluation logic.
4. **Correctness before performance.** Runtime efficiency matters only when the implementation performs useful work correctly.
5. **Measure rather than assume.** Performance claims require measurements; benchmark infrastructure must itself be validated.
6. **Minimal unnecessary abstraction.** Prefer straightforward systems with explicit responsibilities.
7. **Modular language support.** Language-specific details belong in adapters, not benchmark specifications or test logic.
8. **Transparent methodology.** Publish scoring, measurement protocols and known limitations.
9. **Efficient infrastructure.** Avoid unnecessary dependencies, memory overhead and orchestration complexity.
10. **Version everything.** Changes to specifications, fixtures or evaluation semantics must be traceable.

## Technology preferences

- TypeScript and Bun for the primary orchestration CLI.
- SQLite for local metadata and benchmark application storage.
- Docker for candidate isolation.
- Black-box HTTP testing for language independence.
- Structured JSON for interoperable results.
- Go or another validated low-overhead tool for load generation.

These are implementation preferences, not inviolable constraints.

## Repository boundaries

This repository is intended to contain public benchmark infrastructure.

Private hidden tests, confidential evaluation fixtures and evaluator-specific secrets belong in a separate repository.

The public repository may contain interfaces, schemas and contracts required for interoperability with that evaluator.

Do not create a directory misleadingly described as secure merely because its name contains `private` or `hidden`.

## Current development stage

**Round 0 reference verification and public contract freeze (0.1.0).**

Milestone 1 infrastructure and the Round 0 specification/public suite are complete.
A standalone TypeScript/Bun reference now implements SlopShop and passes all 39
public cases in Docker, including empty initialization, restart durability and
externally injected SQLite write failure. It is an infrastructure reference,
not an AI-generated experimental submission or evidence about language rankings.
The original `examples/reference` remains the Milestone 1 smoke probe.

Hidden evaluation, a saturation load generator, model orchestration and a
leaderboard remain deferred. The saturation workload document is a design only.

## Project status

Experimental. Methodology and future scoring remain subject to review. Published
Round 0 contract 0.1.0 is frozen; changes require a separately versioned release.

Do not interpret early development runs as scientifically validated language rankings.

## Milestone 1 usage

Requires Bun (tested with 1.4.4), a local Linux Docker Engine accessible to your user,
Docker CLI, and enough disk space for fixtures and disposable workspaces. Install
Bun using its official installation instructions, then from the repository root:

```bash
bun install --frozen-lockfile
bun run slopbench fixtures verify
bun run slopbench fixtures generate --profile small --seed 12345
# Explicit setup step requiring registry/network access:
docker pull oven/bun:1.3.1
bun run slopbench evaluate --candidate ./examples/reference
bun run slopbench report --latest
bun run slopbench self-test
```

The self-test evaluates the reference twice: its normal mode must pass and its
faulty mode must fail a product assertion. Small fixtures with seed 12345 are
included. Install and tests never generate Medium or Large fixtures. Generate
those only by explicitly selecting `--profile medium` or `--profile large`.

```bash
bun run format
bun run lint
bun run typecheck
bun test
# Opt into actual Docker integration (requires the image above):
SLOPBENCH_DOCKER_TEST=1 bun test
```

Default tests exercise the controller using a simulated Docker command transport
and a real local HTTP test server. They do not prove container isolation. The
opt-in Docker tests and `self-test` exercise actual containers.

Implementation and contract details: [Milestone 1 technical notes](docs/milestone-1.md).
Language-neutral versioned schemas are in [spec/schemas](spec/schemas).
Source is separated into `src/fixtures`, `src/schemas`, `src/runner`, `src/harness`
and `src/storage`; `examples/reference` is an infrastructure probe.

### Verification in the implementation environment

Milestone 1 has passed end-to-end verification with Bun 1.4.4 and Docker Engine
29.9.2 on Linux, without sudo. `SLOPBENCH_DOCKER_TEST=1 bun test` passes all ten
tests, including real container execution and build/runtime isolation probes.
`self-test` passes: the reference succeeds and its faulty mode is classified as
`test_assertion_failure`. JSON artifacts, SQLite rows, source hashes, deterministic
fixture regeneration and resource cleanup were checked.

The runner explicitly selects Docker's `json-file` logging driver and connects
directly to the candidate's IPv4 address on a per-run internal bridge. No host
port is published. This requires a local Docker daemon and host-to-bridge access.
The image used for verification was
`oven/bun@sha256:9c5d3c92b234b4708198577d2f39aab7397a242a40da7c2f059e51b9dc62b408`.

See the [verification report](docs/verification.md) for commands, outcomes, fixes
and remaining isolation limitations. This is not a hermetic or hostile-code
sandbox. The frozen Round 0 contract and its separate reference are described below.


## Round 0 specification and public tests

Start with the [language-neutral contract](benchmark/spec/round-00.md),
[OpenAPI 3.1.1](benchmark/spec/openapi.yaml), and
[test setup instructions](benchmark/tests/README.md). The contract defines
catalogue reads, transactional inventory/orders, exact sales analytics, streaming
product import and deterministic demand simulation. Candidate database layouts
remain implementation choices. This repository supplies specifications, fixtures,
tests, small numerical oracles and a separately isolated reference implementation.

```bash
bun install --frozen-lockfile
bun run round0:check
# Requires the Docker image from the setup above; all 39 cases, no skips:
bun run round0:reference-test
bun run round0:verify-freeze
# Discover tests without starting any candidate:
bun run round0:test --discover
# Once an independently implemented candidate is ready with the public fixture:
bun run round0:test --domain catalogue --url http://CANDIDATE:8080
```

Python 3 (stdlib only) is required by `round0:check` for independent numerical
verification. Without a conforming candidate, discovery runs the oracle and
visibly skips live HTTP tests; this is not a full acceptance pass. The Milestone 1
smoke reference is not expected to satisfy Round 0. The saturation methodology
is [a design document](benchmark/workloads/saturation-round-00.md), not a load
generator. Medium/Large simulation profiles never run automatically.

[Requirement traceability](docs/round-00-traceability.md) maps every public test to
published requirements, proposed private checks and performance families.
[Design decisions](docs/round-00-design-decisions.md) record numerical conventions,
fixture limitations and frozen numerical/business policies.

[Round 0 verification](docs/round-00-verification.md) records what was validated
and distinguishes discovered/skipped HTTP cases from actual acceptance passes.

The reference controller creates six fresh domain databases plus an empty instance,
each on its own internal Docker network. It retains validated JSON results, JUnit,
logs and environment/cleanup audits under `runs/<run-id>`, with a SQLite index entry.
`bun run slopbench report --latest` displays the result. It uses real SQLite lock
contention for the storage-failure case; there are no candidate test backdoors.

The immutable release file list and SHA-256 are recorded in
[the contract freeze manifest](benchmark/spec/round-00.freeze.json). `round0:check`
verifies it. Do not regenerate the hash to bless edits to this release; publish a
separately versioned contract. The [Task 3 verification report](docs/task-3-verification.md)
records observed results, the pre-freeze clarification and remaining limitations.
