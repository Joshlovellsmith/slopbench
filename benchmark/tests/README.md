# Public Round 0 acceptance tests

These are black-box HTTP tests for contract/suite 0.1.0, not a SlopShop application.
They use Bun only in the external controller. Any candidate language/runtime may
implement the contract. Run commands from the repository root.

## Without a conforming candidate

```bash
bun install --frozen-lockfile
bun run round0:check
bun run round0:test --discover
bun run typecheck
bun test tests/round0-infrastructure.test.ts
```

Discovery executes only the numerical oracle test and visibly skips HTTP tests.
A zero discovery exit status is **not** a candidate acceptance pass. The controlled
HTTP transport test in `tests/round0-infrastructure.test.ts` serves fixed response
fixtures, exercises the adapter's success/diagnostic paths and validates schemas;
it does not implement or prove any SlopShop behavior.

`examples/reference` is the Milestone 1 two-endpoint smoke probe. Its `/products`
response deliberately differs from Round 0. Failing Round 0 tests against that
probe would be expected candidate assertions, not benchmark infrastructure bugs.
`bun run slopbench evaluate` still runs the Milestone 1 smoke suite; it is not a
Round 0 controller. No language-specific launcher or new runtime abstraction has
been added in this task.

## Candidate setup and isolated domains

A supplied candidate must run behind HTTP after initializing its own fresh SQLite
database from `benchmark/fixtures/public` (seed 12345, twelve products, four
customers), using the existing `FIXTURE_DIR`, `DATABASE_PATH` and `PORT` input
contract. The public fixtures are included, verified and reproducible using:

```bash
bun run round0:fixtures
```

This explicit command regenerates only the tiny public and zero-record fixtures,
using the existing v1 generator; it never generates Medium or Large. Fixtures are
immutable inputs, not the candidate's writable database. Tests do not inspect
SQLite or prescribe any table layout. A newly started **separate fresh database
per domain** is required. Within a domain tests use disjoint IDs/products or
explicit before/after reads; they may share that domain's committed state.
Run test cases serially within each domain (the wrapper default); do not add
Bun's `--concurrent` flag, particularly when lifecycle hooks restart the instance.
Do not rerun a mutation domain against its already-used DB. A process restart
alone must preserve state and is not a reset.

```bash
bun run round0:test --domain catalogue --url http://CANDIDATE:8080
bun run round0:test --domain orders --url http://OTHER-CANDIDATE:8080
```

The before-all check validates readiness and every baseline product/stock against
the public fixture. This fails with a useful diagnostic on a wrong dataset or
old database. Running domains independently does not mean partial API
implementations qualify: order/analytics tests use product import to create exact
business cases; inventory/catalogue are used to observe order effects. All are
published Round 0 endpoints, never test-only application routes.

For actual empty-database initialization coverage, provide another candidate
loaded from `benchmark/fixtures/empty` via `--empty-url`. Catalogue, analytics and
simulation contain empty-target tests. They are read-only and may share one
empty database across those domains. Empty-window/filter tests also execute on
the nonempty public dataset.

For all domains, supply a controller-owned JSON plan (URLs shown are placeholders;
configure the real isolated addresses, not public network services):

```json
{
  "catalogue": {"url":"http://candidate-a:8080","emptyUrl":"http://empty:8080"},
  "inventory": {"url":"http://candidate-b:8080"},
  "orders": {"url":"http://candidate-c:8080","controlUrl":"http://controller:9000"},
  "analytics": {"url":"http://candidate-d:8080","emptyUrl":"http://empty:8080"},
  "import": {"url":"http://candidate-e:8080"},
  "simulation": {"url":"http://candidate-f:8080","emptyUrl":"http://empty:8080"}
}
```

```bash
bun run round0:test --all --targets benchmark-targets.json
```

Main URLs must be distinct and refer to independent databases. URL aliases alone
do not guarantee independent state; the external controller must ensure it.
Omitted empty/control targets cause explicit skips; those runs do not establish
full lifecycle/empty-data acceptance. No conforming application or controller
hook exists in this repository yet. The suite is ready for them, but its entire
HTTP acceptance pass cannot currently be claimed.

For direct Bun use, environment variables are `ROUND0_DOMAIN`, `ROUND0_BASE_URL`,
optional `ROUND0_EMPTY_URL` and `ROUND0_CONTROL_URL`, or `ROUND0_TARGETS` pointing
to the plan file. Prefer the wrapper, which validates selections and clears
unrelated inherited Round 0 target settings. All live HTTP calls have bounded
timeouts; heavy load profiles are outside this suite.

## External lifecycle controller (not a candidate API)

Persistence and storage-failure cases require a separately supplied controller.
It must be inaccessible to candidate containers, accept only requests from the
evaluator, and own the candidate instance/database already selected for that
domain. It must not expose evaluator secrets or filesystem paths to candidates.
The optional `controlUrl` supports three POST actions, no body, response 204:

* `/restart`: gracefully stop and restart the same candidate with the same
  database, fixture and input environment. Keep the candidate base URL stable.
  Return only after the restart has been initiated; the test polls readiness.
* `/storage-failure-on`: inject SQLite write/commit failure while preserving
  process liveness and committed reads, without changing existing data. Return
  only when the failure condition is active. Implement this through the test
  environment (e.g. controlled storage failure), never a candidate test backdoor.
* `/storage-failure-off`: remove that condition and wait for normal writes/reads
  to become possible again.

This defines a narrow evaluator hook interface, not an implementation. A separate
private evaluator can use its own local process/storage orchestration to fulfill
it or express the same cases without an HTTP controller. There is no reset
endpoint in SlopShop. Mismatched-fixture startup and crash recovery strategies
are listed in the traceability matrix, with no hidden tests implemented here.

## Results and maintenance

Test names include a stable case ID and every referenced normative requirement.
Responses are checked against the committed OpenAPI JSON Schemas (Ajv 2020), then
against explicit values/invariants. Request schemas do not replace cross-field,
stream, transactional or semantic tests. Diagnostics include endpoint, expected
HTTP status, actual response and schema path. No opaque application snapshots
are used.

`round0:check` checks generated OpenAPI freshness, validates it with Redocly,
checks requirement/test/workload traceability, and independently verifies vectors
with Python 3 (stdlib only). `round0:traceability` regenerates the requirement index
and matrix; `round0:generate-openapi` regenerates the JSON-syntax YAML document
from existing product fields plus Round 0 additions. Commit artifacts with sources.
The source specification, not generated helper code, is the cross-language contract.

The wrapper propagates Bun's test exit status; configuration errors exit 2. Live
runs can still contain explicitly reported skips; zero failures alone does not
mean complete acceptance. To integrate with run storage, use the existing shared
Result/Outcome v1 schema, benchmark `slopshop-round-00` version `0.1.0` and suite
`round-00-public` version `0.1.0`. Preserve missing measurements as absent. Startup,
infrastructure and candidate assertion failure classifications stay distinct.
Do not persist a claim of a passed complete suite from discovery/skipped tests.
This task does not implement a second result protocol or duplicate the run index.
