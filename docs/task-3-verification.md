# Task 3: Round 0 reference verification and freeze

Verified 2026-10-29 on local Linux amd64, Docker Engine 29.9.2 without sudo,
Bun controller 1.4.4, candidate Bun 1.3.1, TypeScript 5.9.3, Python 3.14.4,
Redocly 2.72.0, Ajv 8.20.0 and ajv-formats 3.0.1.

## Outcome

The standalone [reference](../examples/round0-reference/README.md) implements all
11 Round 0 HTTP operations with SQLite persistence. All **39 public cases pass,
zero failures and zero skips**: 38 live HTTP cases plus the numerical oracle case.
This includes actual empty initialization, concurrent adjustments/orders, durable
restart, injected SQLite write-lock failure, >1 MiB streamed import and exact
simulation vectors. It is a verification reference, not an experimental attempt
or evidence of language performance.

| Domain | Passing cases |
| --- | ---: |
| Catalogue | 7 |
| Inventory | 5 |
| Orders | 10 |
| Analytics | 5 |
| Import | 6 |
| Simulation (including oracle) | 6 |
| Total | 39 |

Final run: `dfad4c7a-d7b7-4604-bac5-efe3bf3078d5`. The validated JSON result is retained in
[the exported verification artifact](verification/round-00-reference-result.json).
Its original JUnit, public stdout/stderr, per-container logs, SQLite/mount audit,
supplemental audit and cleanup record remain under `runs/dfad4c7a-d7b7-4604-bac5-efe3bf3078d5/` on the
verification host. `runs/index.sqlite` contains the matching passed row and
absolute result reference. Those transient run files are intentionally ignored
by Git; the exported JSON retains their original host paths as provenance.

Candidate source fingerprint:
`fe222f84a2e99630eaa8de9c06d5e3c8a40c9fb005672769d772af7db2f14390`.
Resolved image ID:
`sha256:9c5d3c92b234b4708198577d2f39aab7397a242a40da7c2f059e51b9dc62b408`.
Both identities were checked against the artifact. Case outcomes/durations were
compared structurally with JUnit and the result was validated before persistence.
An initial ad-hoc JSON-string comparison incorrectly treated object-key ordering
as significant; verification was corrected to compare parsed structures.

## Commands and observed results

| Command | Observed result |
| --- | --- |
| `docker version --format '{{.Server.Version}}'` | 29.9.2, no sudo |
| `bun install --frozen-lockfile` | Success; no dependency changes |
| `bun run format` | Success; final files formatted |
| `bun run lint` | Success |
| `bun run typecheck` | Success |
| `SLOPBENCH_DOCKER_TEST=1 bun test` | 23 pass, 38 skip, 0 fail; 419 assertions |
| `bun test tests/round0-reference.test.ts` | 6 pass, 0 fail; 96 assertions |
| `bun run slopbench self-test` | Success: normal smoke passes; faulty smoke is test_assertion_failure |
| `bun run round0:fixtures` | Regenerated tiny/empty fixtures with identical frozen bytes |
| `bun run slopbench fixtures verify` | Published Small manifest/hashes verified |
| `bun run round0:reference-test` | 39 pass, 0 fail, 0 skip; 772 assertions; supplemental audits pass |
| `bun run slopbench report --latest` | Passed reference run; 39 passed, 0 failed |
| `bun run round0:check` | OpenAPI valid, 32 requirement groups/39 cases/11 operations mapped, Python vectors verified, freeze matches |
| `bun benchmark/scripts/freeze.ts --freeze` | One-time creation of 38-file freeze manifest |
| `bun run round0:verify-freeze` | Success; same aggregate hash after regeneration and verification |

The general `bun test` command intentionally skips 38 HTTP cases without configured
candidate targets. Its 23 passes include both real Milestone 1 Docker integration
checks and new reference/parser/freeze tests. The separate reference command starts
all required targets and runs every public case without skips. Discovery is not
being counted as acceptance. Full-infrastructure test output is also retained in
the final run directory as `infrastructure-tests.log`.

An independent Python calculation checked every frozen file's byte length/SHA-256
and reconstructed the aggregate framing/hash. Python also independently verifies
ten random words and seven simulation vectors. Unit checks compare the reference
kernel with golden outputs and forty additional small cases, and check an input
above the small oracle's 100,000-operation cap. Default tests never run Medium/Large.

## Defects and corrections

* **Pre-freeze ANA-001 clarification:** aggregation overflow is checked for every
  group before the top-products limit, including excluded groups; there is no
  extra grand total across independent groups. The existing ANA-validation case
  was strengthened with a higher-quantity free product ahead of an overflowing
  product. The initial reference returned 200 for LIMIT 1 and failed the assertion.
  The reference now uses an SQL window overflow flag before limiting. No existing
  expectation was relaxed and no case was removed.
* **JUnit ingestion:** a greedy attribute expression joined self-closing passes
  to a subsequent failure. The parser was fixed and covered by a regression test.
  The repeat deliberately failing run `bc1af1dd-0d97-48b4-8b6a-13f7554b98b8`
  persisted 38 passes/1 failure with `test_assertion_failure` and an index row.
* **Raw HTTP paths:** Bun's native Fetch server normalized dot segments. The
  reference uses Node-compatible HTTP ingress to preserve the raw request target
  and enforce GEN-005. The specification was retained.
* **Early chunked rejection:** cancelling an unfinished input iterator destroyed
  the HTTP connection before sending JSON errors. Readers now release without
  cancellation; the response closes incomplete bodies after sending its envelope.
  An added regression test and three unfinished-body HTTP probes cover this.
  This was a reference correction after freeze; the public contract hash stayed
  unchanged.
* **Audit startup race:** the equivalent-manifest probe now keeps its reordered
  representation in place until readiness, rather than restoring it immediately
  after `docker start`. The final run verifies the intended representation.
* **Shared result metadata:** Result v1 adds optional `durationMs` and benchmark
  `contractHash`, and permits missing single-request latency/status on a case that
  spans multiple HTTP requests. No zero measurements or fictitious HTTP statuses
  are substituted. Existing artifacts remain valid; strict external JSON Schema
  consumers need the updated exported schema for the additive fields.

## Environment and cleanup checks

The controller starts six separate fresh domain databases plus one empty instance,
each with its own internal Docker network. Build and runtime use the candidate
manifest inside Docker. Runtime has one CPU, 256 MiB memory, 128 PIDs, no extra
capabilities, no-new-privileges, numeric user/group 1000:1000, a read-only root,
read-only candidate/fixture inputs and its own writable data directory. No host
ports are published. The lifecycle service listens only on host loopback.

A real external SQLite `BEGIN IMMEDIATE` lock causes the storage failure. The
reference's bounded busy timeout returns 503 STORAGE_UNAVAILABLE without an order
or decrement, and writes resume when the controller releases its lock. There is
no fault/reset/restart route in the candidate.

All seven databases pass generic SQLite header/integrity checks. A changed fixture
manifest is rejected at startup without modifying the database; a reordered but
parsed-equivalent manifest starts successfully. Fourteen additional raw HTTP
checks cover path decoding, ignored GET entity headers/body, JSON key/scalar/UTF-8
validation, exact 1 MiB support, oversize rejection, quoted charset and unfinished
chunked errors.

Runtime probes confirm no host Docker socket, unrelated host repository file or
controller-only canary is visible. Inputs/root are read-only, data is writable,
the process has group 1000 only (no host docker group 987), and the loopback
controller and other candidate instance cannot be reached. Mount configuration
contains only the intended workspace, fixtures and data. These probes establish
observed boundary properties, not absence of every possible escape.

Cleanup records contain no errors. All seven runtime containers/networks and the
fresh temporary directory are removed. Independent `docker ps -a` and
`docker volume ls` return no entries; networks are only bridge/host/none. No
`slopbench-round0-*` temporary directory remains.

## Freeze and limitations

Frozen benchmark `slopshop-round-00` and suite `round-00-public`, version **0.1.0**.
[The freeze manifest](../benchmark/spec/round-00.freeze.json) records 38 files and
aggregate SHA-256:

`470818aaf90788d7d3810e54dcf374261d38faf4a71fc3ff0de6dff916653e51`

Its exact scope/framing are documented in the manifest and
[design decisions](round-00-design-decisions.md). This is a bundle hash, not the
hash of the manifest file itself. The verifier detects content, scoped-file-list
and validation dependency drift; tests exercise those failures. Creation refuses
to overwrite an existing record. Published semantic/public-case changes require
a new contract version with the old freeze preserved. Reference implementations
and verification reports may change independently and have their own provenance.

No hidden evaluator, saturation generator, future round or model orchestration
was implemented. A passing public suite is not a proof over every legal input.
Full 2 GiB/two-million-record imports, Medium/Large simulation and resource/latency
saturation remain unmeasured. The single-threaded reference blocks other requests
during long simulation, makes no efficiency claim, and can leave staging files
after a hard process crash until its data directory is cleaned up.

Docker shares the host kernel, disk has no quota, images/controller must be trusted
and internal bridges do not isolate every reachable host service. SIGKILL or daemon
failure can interrupt cleanup. No actual private evaluator resources are present;
only their exclusion from mounts and controller-canary inaccessibility were checked.
Use a dedicated host for untrusted candidates; execution is not hermetic or a
hardened hostile-code sandbox. The next validation step is an independent
implementation in another language against this frozen public package, followed
by separately controlled performance/private evaluation work.
