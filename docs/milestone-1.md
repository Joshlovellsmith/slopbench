# Milestone 1 technical notes

## Fixture protocol v1

`fixtures/<profile>/` contains UTF-8 JSONL files and a JSON manifest, all with LF
terminators. Products and customers are independent records; there are no foreign
keys in this milestone. Field definitions and validation live in `src/schemas` and
`spec/schemas/*-v1.json`. Prices are integer minor currency units (no currency
conversion). Popularity is a synthetic relative integer weight, not an observed
sales metric.

Generator v1 uses the Numerical Recipes LCG:
`state = (1664525 * state + 1013904223) modulo 2^32`. The unsigned seed is an
integer in `[0, 4294967295]`. Multiplication uses `Math.imul`; draws, modulo
operations, and integer arithmetic are pinned in `src/fixtures/index.ts`.
No random or wall-clock APIs enter fixture generation. Fixed field insertion order,
`JSON.stringify`, and a trailing LF define serialization. IDs are sequential,
eight-digit zero-padded numbers with `p-`/`c-` prefixes. Records follow ID order;
product draws precede customer draws, so changing product counts changes customers.

Prices use a product of squared uniform integers to produce many cheaper items
and fewer costly ones. Popularity weights follow a rank-based inverse distribution.
The first products explicitly include zero price/stock, a very high price,
discontinued status and Unicode names. Other records have periodic discontinued
and inactive statuses. Customer timestamps are whole seconds in a fixed five-year
interval starting at `2020-01-01T00:00:00.000Z`, rendered with ECMAScript ISO UTC.
These distributions are simple synthetic approximations, not calibrated retail data.

Small is 1,000/200 products/customers; Medium 100,000/10,000; Large
1,000,000/100,000. `generate(dir, seed, counts)` additionally supports explicit
counts up to ten million per file. Generation and verification retain one record
at a time; disk space and generation time scale with counts. SHA-256 covers each
file's exact bytes including LF; the manifest stores versions, seed, counts and
both hashes. There is no self-referential manifest hash. Fixture identity is the
entire manifest (especially both content hashes), not just its profile directory.
Verify checks hashes, record schemas, sequential IDs and counts. A hash proves
integrity against the supplied manifest, not authenticity. Published versions
must be treated as immutable; change generator/schema version when changing bytes.
The CLI will overwrite an explicitly selected output directory; use a new output
path for experiments with different seeds. Interrupted generation must be
regenerated or verified before use; multi-file generation is not atomic.

## Candidate smoke contract v1

This is a runner probe, not the SlopShop application specification. Candidate
workspaces contain `candidate.json`, validated against `candidate-v1.json`:

```json
{
  "schemaVersion": "1",
  "id": "reference",
  "language": "typescript",
  "runtime": "Bun 1.3.1",
  "image": "oven/bun:1.3.1",
  "build": ["bun", "--version"],
  "start": ["bun", "server.ts"]
}
```

Commands are argument arrays; shell syntax requires an explicit container shell.
Only Docker executes them. The controller copies the source, excluding `.git`
and `node_modules`, rejecting symlinks and special files. Candidate workspaces
containing this repository root are rejected. The fingerprint hashes sorted
relative file paths, executable permission bits, byte lengths and contents.
Each header is JSON followed by the exact file bytes, making boundaries explicit.
Copied bytes are the bytes hashed. Empty directories, timestamps and other
permission bits are excluded. Dependency/build outputs are not part of this
source fingerprint; the resolved image content ID is recorded separately.
Do not put secrets in a submitted candidate workspace.

The image must already be local. The runner resolves its content ID and uses that
ID with `--pull=never` for both phases. The example tag is convenient but mutable;
reproduce experiments using an image digest and retain the referenced image.
Build has no network by default. `--build-network default` explicitly permits
Docker's default build-container network for dependency installation; registry
resolution and external dependency services then affect reproducibility. Vendor
or pin dependencies and record a lockfile. Build stdout/stderr go to `build.log`.
Build may write `/workspace`; only its copied workspace persists into runtime.
Dependency installation into other container paths will not persist. Prebuild
such dependencies into the image, or install them locally under `/workspace`.

Runtime binds only the copied workspace read-only, the three copied fixture
files read-only at `/fixtures`, and a fresh writable directory at `/data`.
`FIXTURE_DIR=/fixtures`, `DATABASE_PATH=/data/candidate.sqlite`, and `PORT=8080`
are set explicitly. Each run's database starts absent. Candidates bind
`0.0.0.0:8080`; the controller discovers the container IPv4 address on its
per-run internal bridge and connects directly from the local Docker host. No host
port is published. Docker 29 does not publish ports on internal bridges, so this
controller intentionally requires host-to-bridge connectivity.
The reference streams products into a fresh SQLite database before serving.

Required endpoints (GET only):

* `/health`: HTTP 200, `Content-Type: application/json`, any JSON object.
  Readiness polls for HTTP 200; the suite subsequently validates the JSON object.
* `/products`: HTTP 200, JSON object `{ "products": [product] }`, containing
  **exactly the first product in fixture ID order**, with every product field
  equal to the input fixture (no extra product fields). JSON key order is immaterial.
  This deliberately fixed one-record response avoids a million-record HTTP body.
  The runner rejects fixtures with no products.

No pagination, mutations, auth or other business behavior is specified here.
Responses are limited to 1 MiB and 3 seconds per test request, further constrained
by the execution deadline; redirects fail. The public harness performs both
requests and compares the product against the controller's fixture copy. Faulty
reference mode (`FAULTY=1`, enabled by `self-test`) increments its price by one.
A live candidate returning wrong data, malformed JSON, HTTP errors or failed HTTP
requests fails public assertions. A container observed exiting after readiness is
instead a runtime failure. Diagnostics include expected/received products.

## Results, measurements and persistence

`Result` schema v1 identifies benchmark, suite, candidate source, declared language
and runtime, fixture manifest, controller platform/architecture/kernel/CPU model/host memory/Bun version,
Docker daemon version, image ID, resource limits and timeout/network settings.
Additional host detail fields are optional in v1 so early artifacts without them
remain valid; the current controller always records them.
Model/harness configuration and development budgets/usage are optional typed
metadata; the smoke CLI has no agent development session, so records `{}` rather
than inventing measurements. Candidate runtime is declared metadata, not
independently attested by this milestone.

Status is a discriminated passed/failed union. Failure kinds:

| Kind | Meaning |
| --- | --- |
| `build_failure` | Candidate build command exits unsuccessfully |
| `startup_failure` | Exit before readiness or readiness deadline expires |
| `infrastructure_failure` | Docker/controller failure, including cleanup failures |
| `timeout` | Build deadline or total runtime execution deadline expires |
| `test_assertion_failure` | Live candidate fails public HTTP assertions |
| `candidate_runtime_failure` | Container exits after readiness during the suite |
| `resource_limit_violation` | Docker reports OOM during build/runtime |

A Docker run error 125 is treated as infrastructure failure. CPU throttling and
PID limits are enforced but not independently diagnosed; they may manifest as
timeouts/runtime failures. Runtime deadline covers startup/readiness and tests;
build has a separate deadline. Docker control commands have a 30-second timeout.
A watchdog requests container kill when runtime expires; cleanup then removes it.
Memory is 256 MiB, CPU quota one core, swap allowance no greater than memory,
and PID count 128. Cleanup overhead is outside the measured runtime deadline.
Container exit code and OOM state are recorded after stopping; a stop-induced
exit code describes controller termination rather than a candidate crash.

Individual outcomes include measured elapsed latency in milliseconds and HTTP
status when available. Timing uses the monotonic performance clock and includes
response reading, parsing and assertion overhead. Aggregate min/upper median/max
cover the two test outcomes, including failures with observed latency. Readiness
polls are excluded. This is a smoke measurement, not a statistically meaningful
performance comparison. Throughput (`requests/second`), peak memory (`bytes`), CPU
time (`seconds`) and CPU utilization (`ratio`, 1 = one full CPU core) are typed but
not measured. Absent metrics remain absent, never replaced with zero.

`runs/<uuid>/result.json` is validated before persistence; JSON output is atomically
renamed before inserting metadata and an artifact path in `runs/index.sqlite`.
SQLite uses WAL and stores no logs or measurement series. A crash between artifact
rename and index insertion can leave an unindexed artifact; this is not a distributed
transaction. `report --latest` validates the referenced artifact on reading.
Logs live beside JSON, with container stdout and stderr captured separately.
The runner explicitly selects the `json-file` logging driver with bounded rotation,
independent of the daemon default. Docker log rotation retains approximately the
last 1 MiB; build logs stream to disk
and currently have no disk quota. Persistence failures are CLI errors. Invalid
candidate manifests/workspaces/fixtures are preflight input errors, before a run
identity with complete validated metadata can be persisted. Valid-input runs,
including unavailable Docker, produce JSON plus an index entry.

CLI exit statuses: 0 success, 1 candidate assertion failure, 2 input, infrastructure
or other execution failure. `self-test` returns 0 only for the expected normal-pass
and faulty-assertion-fail pair; any unmet expectation returns 2.

## Threat model and limitations

This targets cooperative experimental submissions on a dedicated local Docker
host, with resource constraints and reduced accidental access. It is **not
hermetic execution or a hardened sandbox for hostile code**. Docker daemon access
is powerful; use a dedicated disposable host for untrusted submissions. Rootless
Docker, remote daemons, Windows hosts and user namespace remapping are unverified.
The controller's temporary bind paths require a local daemon.

Runtime uses a per-run internal Docker bridge without published host ports,
drops all Linux capabilities, enables `no-new-privileges`, runs as the host
user's numeric UID/GID, and mounts a read-only root filesystem with a small tmpfs.
The runner should itself run as an ordinary non-root user. Build uses the same
CPU/memory/PID/capability constraints but a writable container root filesystem.
No repository root, Docker socket, evaluator code or host environment variables
are mounted/passed to the candidate. Candidate images are operator-supplied and
must be trusted; Docker image metadata/entrypoints are part of that trust boundary.
Candidates share the host kernel. Disk writes during builds/data ingestion are
not quota-limited. Resource statistics beyond OOM/exit status are not collected.

Internal bridges block normal external routing but do not establish isolation
from the Docker host itself. Host access, DNS, IPv6, bridge behavior and firewall
rules need auditing on the target host. A candidate may still interact with
reachable host services; use a dedicated host with no secrets/services. Controller
HTTP is intentionally the only evaluation interface. No outbound dependencies
are required by either reference. Dependency pulls/build network exceptions are
explicit setup choices, never needed during the HTTP suite.

Finally blocks clean normal success and failure paths, removing both containers,
the network, anonymous image volumes (using `docker rm --volumes`), and temporary
data. SIGINT/SIGTERM request candidate termination and
record a timeout failure before normal cleanup. A controller crash, SIGKILL, or
a second termination during cleanup can leave resources: inspect/remove `sb-<run UUID>` containers and matching
`sb-<run UUID>-net` networks before further experiments. This first milestone does
not promise recovery after controller death or daemon outage. Result artifacts
remain available when normal cleanup fails, classified as infrastructure failure.

## Separate private evaluator integration

Use the versioned public endpoint contract, fixture manifests, source identity and
`spec/schemas/result-v1.json` as the language-independent interchange protocol.
The TypeScript validator additionally checks correctness summary consistency
(which JSON Schema cannot express). Regenerate schema exports using
`bun scripts/export-schemas.ts` after changing schemas; incompatible changes need
a new protocol version, never silent reinterpretation of old results.

A private repository can consume these formats and the HTTP harness boundary,
assign its own suite identity/version and produce validated artifacts. Keep its
test implementation, secrets, workloads and fixtures outside candidate source
snapshots and mounts. Only intentionally supplied data may cross the container
boundary. Do not import hidden suites into this repository or rely on obscurity
of filenames. Remote/multi-host execution and authenticated artifact transport
are future integration work. There is no hidden suite, saturation workload,
scoring/ranking system or dashboard here. Task 3 separately adds the Round 0
SlopShop reference; `examples/reference` remains this milestone's smoke probe.
