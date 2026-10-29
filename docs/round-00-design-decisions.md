# Round 0 design decisions and review notes

The contract is implementable as written; the decisions below are policy choices
recorded for the frozen 0.1.0 release, not unspecified behavior.
Normative details live in `benchmark/spec/round-00.md` and `openapi.yaml`.

## Scope and compatibility

Round 0 defines a language-neutral SlopShop contract/public suite. Task 3 adds
`examples/round0-reference` and a Docker verification controller. The original
`examples/reference` remains the Milestone 1 smoke probe; its two requests are not
Round 0 acceptance. Both use the shared run protocol/storage/fixture generation.
No hidden tests, saturation generator, dashboard, model orchestration or future
round was implemented. The reference is not an experimental submission.

The OpenAPI document is 3.1.1 with JSON Schema 2020-12. Its `.yaml` file deliberately
uses JSON syntax, which is valid YAML, avoiding another YAML parser dependency.
Redocly validates it and Ajv validates actual public test responses. Prose carries
cross-field/temporal/transactional rules that schema validation cannot express.
Schema/prose generation checks catch missing operations/requirements; manual review
is still necessary for semantic agreement. Standards/tool references:
[OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) and
[Redocly lint](https://redocly.com/docs/cli/commands/lint).

## API and business policies

* Offset pagination is easy to implement and exposes deep-offset query costs.
  It does not promise cross-request snapshot stability during writes. Primary
  descending sort always uses ascending ID ties. ASCII-sortable keys avoid
  locale-specific name collation; names remain Unicode data.
* Stock adjustments and multi-line orders require durable serial-equivalent
  atomicity. SQLite table design, index names, journal mode and lock strategy
  remain implementation choices. Exact HTTP outcomes, not SQL implementation,
  are tested. Busy retries have a bounded five-second ceiling. HTTP alone cannot
  attest the underlying storage engine; a separate controller can audit the
  quiescent SQLite file header/integrity without requiring any table layout or
  inspecting candidate source. This environment audit is separate from HTTP
  acceptance, and is performed by the public reference controller.
* Clients supply unique order IDs and exact orderedAt values. This removes
  wall-time nondeterminism and permits deterministic historical analytics.
  Duplicate IDs conflict without additional effects; retry is reconcile-by-ID,
  not a general idempotency middleware requirement. Registration time does not
  constrain synthetic order history.
* Duplicate product lines are rejected, not merged. Inactive customers/products
  cannot place/be sold in new orders. Discontinued inventory remains adjustable.
  Only confirmed orders exist; cancellations are deliberately unsupported.
* Money is integer minor units. MAX_SAFE bounds both individual orders and
  analytics outputs. Out-of-range exact results explicitly return NUMERIC_LIMIT;
  there is no silent wrap, float rounding, arbitrary currency formatting or
  decimal-string escape hatch. Verify this bound is appropriate for future
  experiment scales before publishing much larger histories.
* JSON numeric decoding explicitly uses binary64 rounding then integer validation,
  while arithmetic is exact integers. This keeps equivalent JSON spellings
  (`1`, `1.0`, `1e0`) compatible and avoids imposing a custom lexical number
  parser. Rust/C#/other strongly typed DTO parsers may need to accept integral
  floating spellings rather than reject them automatically. Very long decimal
  spellings can round to an integer by the documented rule. This interoperability
  choice warrants review; changing it later is a contract version change.
* Unique JSON object keys and valid Unicode scalars are required. Duplicate-key
  permissive parsers must add detection. This is intentional request-integrity
  validation, not permission for last-key-wins behavior. Error strings themselves
  are not stable and may differ between languages.
* Imports are create-only, whole-stream atomic, allow 2 GiB and two million
  records, and support chunked transport. Disk staging is allowed; atomicity is
  not an instruction to buffer the body in RAM. Retrying a committed import
  conflicts; response loss is inherently uncertain without a replay protocol.
  Five-second writer retry limits and long imports can create contention;
  measure this separately, rather than hide it by weakening transactional rules.

## Simulation choices and numerical proof bounds

The numerical workload is a lost-sales inventory policy with fixed-quantity
replenishment and a single outstanding purchase order. Daily arrivals precede
ordering, which precedes demand. Lead time starts from that day's decision;
unsatisfied demand is lost. Those details materially change results and are
pinned by hand-checkable cases and full golden vectors.

The counter hash takes (seed, sorted product ordinal, scenario, day), with low-word
multiplications and logical shifts. There is no stateful PRNG chain between
trajectories. Work can be split by scenario/product without changing results;
days within one trajectory remain state-dependent. At most one future arrival
needs to be retained per trajectory. There is no billion-object history or
massive fixture requirement. A BigInt-based TS rounding oracle and an independent
Python event-calendar oracle check the same committed expectations; the oracles
are deliberately not HTTP services or optimized candidate implementations.

This 32-bit hash compresses a tuple and permits collisions and biased modulo
sampling. It is an explicitly defined synthetic workload, not a statistically
validated demand forecasting engine or cryptographic generator. Statistical
quality and representative demand distributions need separate research review;
using a wider established counter PRNG later would require new vectors/version.
The current function is mathematically unambiguous and cheap enough that daily
state updates, branching and memory management remain part of compute cost.

Stock in a trajectory is at most max(initialStock,reorderPoint+replenishmentQuantity),
no greater than 1,001,000,000. Thus summed ending stock is <=1.001e15 with one
million scenarios; returned metrics fit exact JSON integers. Half-up rounding
numerators may approach 2.002e18, below signed 64-bit max but beyond binary64's
exact-integer range. Languages can use 64-bit intermediates or quotient/remainder
arithmetic; the public TS oracle uses BigInt for rounding. Random multiplication
alone wraps to 32 bits. Reductions elsewhere must not wrap or approximate.

Medium is ~47.8 million operations and Large is ~3.06 billion; profile dimensions
are not duration promises on every language/hardware. Performance measurement
uses unique seeds for timed compute jobs to avoid mistaking repeated-response
cache hits for general compute speed. Medium/Large are never default tests.
Review deadlines/resources on the actual experimental machine before comparing
languages; report timeouts/CPU/resource limits rather than infer incorrectness
from a slower but numerically correct implementation.

## Fixture and statistical limitations

The tiny public and empty datasets are exact v1-generator outputs. Public imports
supply additional books/home/zero-price/overflow cases through published HTTP,
not fixture format changes or prescribed database inserts. Domain-specific fresh
databases make cases reproducible and avoid a secret reset route.

V1 generation's low-bit LCG/category draw pattern is strongly correlated: the tiny
seed-12345 example has one electronics product and eleven clothing products.
This is inherited data, not a balanced four-category distribution. Preserve its
published bytes; report actual category/price/popularity distributions in any
performance campaign. Negative/empty-filter results must be broken out. A future
fixture generator version should address representativeness before broad retail
analytics claims; do not silently regenerate published v1 data with a new algorithm.

Performance families have independent ledgers, resets, load schedules and metrics.
An open-loop schedule with intended-arrival latency includes queueing and omitted
arrivals; long compute/import jobs use duration/work-normalized measures. No
aggregate score, hidden weighting, scientifically validated rankings or implemented
load generator is claimed. CPU/memory/allocation measurements remain absent until
actually collected, matching the shared result protocol.

## Pre-freeze clarification and implementation corrections

Task 3 clarified ANA-001: overflow is checked for every aggregation group before
applying the top-products limit; no additional grand total across independent
groups is defined. The original wording "any count, quantity or revenue" did not
state the limit boundary explicitly. The existing ANA-validation case was
strengthened with a higher-quantity free product that hides an overflowing product
below LIMIT 1. The initial reference failed it (38 pass/1 fail); the implementation
was corrected with an SQL window overflow flag. No expected success/error was
relaxed, no case was deleted, and the suite still has 39 cases. This is a documented
clarification of the pre-freeze 0.1.0 draft, not an edit to an already frozen release.

Raw HTTP checks caught Bun Fetch-server dot-segment normalization, contrary to
GEN-005. The reference uses Bun's Node-compatible HTTP ingress to retain raw paths;
no routing requirement was weakened. A controller JUnit parser bug that joined
self-closing passes to a later failure was fixed and tested. The repeat failing
run was correctly persisted as test_assertion_failure, not infrastructure failure.

Shared Result v1 now permits request latency/status to be absent for a case that
spans multiple requests, adds optional case durationMs, and accepts an optional
benchmark contractHash. Old artifacts remain valid. This corrects mandatory
single-request measurements in the original validator; it does not invent a
latency or an HTTP status for a multi-request case. Consumers of the exported
strict JSON Schema must use the updated schema for the additive fields.

## Verification boundary and freeze policy

All 39 public cases now pass against the reference in Docker without skips,
including restart durability, write-fault rollback, empty initialization and exact
simulation vectors. External raw HTTP, fixture identity and isolation probes also
pass. Public coverage is not a proof of all possible inputs. A 2 GiB import, two
million records, Medium/Large simulations and a saturation campaign have not run.
The numerical kernel supports SIM-001 bounds without importing the capped public
oracle; the ordinary suite runs only small vectors. It keeps trajectory state
constant in days/scenarios; the single-threaded reference blocks other requests
during long computation and makes no performance claim.

`round-00.freeze.json` records contract/suite 0.1.0, per-file sizes/hashes and an
aggregate SHA-256. Framing is UTF-8: literal `slopbench-public-contract-v1` plus LF;
compact JSON identity plus LF; then sorted compact JSON `[path,sizeBytes,sha256]`
tuples, each plus LF. Identity includes schema version, benchmark/suite identities
and exact Zod/Ajv/ajv-formats dependency pins. File paths use `/`, sorted by ASCII.
The freeze record excludes itself. The scoped directories include specifications,
public tests, fixtures, oracle, workload design and exported schemas; explicit files
include generation/check scripts, test setup, shared fixture/validation code, this
decision log and traceability. See its file list for the precise boundary. Reference
source, controller implementation, general README and run reports are excluded;
reference source has its own candidate fingerprint in every run.

`round0:check` verifies the frozen bundle. Content changes, extra files in scoped
directories or changed validation dependency pins fail the check. The creation
command refuses overwrite. Corrections after publication require a separately
versioned release and preserved prior manifest; refreshing this hash to bless an
in-place semantic/test change is prohibited. This is an integrity record, not a
digital signature or hostile-controller attestation.

The reference verification controller uses a separate internal Docker network per
instance, no published candidate ports and a loopback-only lifecycle service.
Only the candidate snapshot and intended fixtures/data are bind-mounted; the host
Docker socket/group, unrelated host files and a controller-only canary are absent.
It reuses Milestone 1 capability/UID/resource constraints. Docker still shares the
host kernel; internal networking does not block every reachable host service,
disk consumption is not quota-limited and SIGKILL/daemon failure can leave resources.
Images/host/controller must be trusted; this is not a hermetic hostile-code sandbox.
Private evaluators must keep their code and secrets outside these mounts and use
a dedicated evaluation host. Private verification proposals remain descriptions,
with no hidden evaluator implementation here.
