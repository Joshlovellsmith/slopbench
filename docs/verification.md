# Milestone 1 verification

Milestone 1's functional acceptance checks now pass on this local Linux host.
No Round 0 work was started. This verifies the published cooperative-submission
threat model, not a hardened sandbox for arbitrary hostile code.

## Environment and commands

Bun 1.4.4, Docker Engine 29.9.2, Linux amd64. `id` now includes Docker group 987;
`docker version` and `docker info` succeed without sudo after restarting the agent
environment. Docker access was not enabled by weakening socket permissions.

The following were executed successfully after the fixes below:

```bash
docker version
docker pull oven/bun:1.3.1
bun run slopbench evaluate --candidate ./examples/reference --runs runs/milestone-1-verification
SLOPBENCH_DOCKER_TEST=1 bun test
bun run slopbench self-test --runs runs/milestone-1-verification
bun run slopbench report --latest --runs runs/milestone-1-verification
bun run format
bun run lint
bun run typecheck
```

The faulty candidate was also evaluated directly using
`evaluate({candidate: "examples/reference", faulty: true, runs: "runs/milestone-1-verification"})`.
Inline Bun verification scripts checked all retained artifacts/index rows and two
independent Small regenerations. Docker lists and `/tmp` were inspected for leaks.

Image content ID and registry digest:
`sha256:9c5d3c92b234b4708198577d2f39aab7397a242a40da7c2f059e51b9dc62b408`.
The runner resolves the image before execution, uses its content ID for both
phases and prevents implicit pulls.

## Actual outcomes

* Reference evaluation: **passed**, health and products both pass. Run
  `bacb5e79-73f2-451a-ab62-ccecca4b3e6b`.
* Direct faulty evaluation: **test_assertion_failure**, health passes, products
  fails because expected price 0 becomes 1. Run
  `e3e8d4d3-2165-43f8-861f-81d9b7a2530a`. This is a candidate assertion, not an
  infrastructure failure.
* Full Docker-enabled suite: **10 passed, 0 failed, 0 skipped**, including the
  conforming/faulty pair and build/runtime isolation checks.
* Self-test: **passed**, normal run `5538f3e0-c252-43a3-90b2-466759e8a7c6`, faulty
  run `4e531e27-4b09-476f-bf92-2c720dccd7f2`. The self-test exits successfully
  only because these outcomes match the expected pair.
* `report --latest`: success; correctly reports the latest intentional assertion
  failure and its expected/received product diagnostic.
* Formatting, linting and TypeScript checks: pass.
* All **13 retained result artifacts** validate: four in `runs`, nine in
  `runs/milestone-1-verification`. Metadata, absolute artifact paths, timestamps,
  candidate IDs, statuses and source hashes match their SQLite rows. Both indexes
  return `ok` from `PRAGMA integrity_check`. Referenced logs exist. Temporary real
  integration artifacts are separately validated inside tests before removal.
* Earlier permission/logging/network failures remain in the index as historical
  `infrastructure_failure` records. They were not deleted or relabeled to make
  verification pass.
* Reference source fingerprint, unchanged across normal and faulty modes:
  `67b34866ff8bfdfc035c54e4803146fc8ba7ca8825e24755cdf1b354ded86af7`.
* Two independent Small generations with seed 12345 match each other and all
  three included fixture files byte for byte. Both generated fixtures validate.
  Product SHA-256: `93679d77a698e37adbfc8712d6efb3c5ea20e12d9999b62acb232d3e2bb3c751`.
  Customer SHA-256: `b732d1b246f61160442c023a63b02a5be06f06b77ee1e4ce3d7bac8118ecdee2`.
* After evaluation/self-test, `docker ps -a --filter name=sb-`,
  `docker network ls --filter name=sb-` and `docker volume ls` return no resources.
  No matching controller/test temporary directories remain under `/tmp`.
  Downloaded image/cache layers and retained run artifacts are intentional.

## Issues discovered and fixed

1. The daemon defaults to Docker's `local` logging driver, whose compression
   setting conflicts with `max-file=1`. The runner now explicitly chooses
   `json-file`, retaining bounded logging without relying on daemon defaults.
2. Docker 29 did not publish host ports for the internal network. A controlled
   diagnostic confirmed host-to-container bridge connectivity. The runner now
   discovers the container's IPv4 address on its per-run internal bridge and
   connects directly to port 8080, publishing no host ports. The diagnostic's
   container/network were removed.
3. Cleanup omitted anonymous image volumes. Container removal now includes
   `--volumes` in success and failure cleanup.
4. Added host metadata fields initially invalidated an older v1 result. Those
   extra fields are now optional within v1, preserving honest absent metadata
   without rewriting earlier artifacts. The current controller records them.

Unit regressions cover explicit logging/no port publication, anonymous-volume
removal and older artifact validation; real integration tests were rerun after
the Docker fixes.

## Isolation evidence and limitations

A public test executes a probe during **both build and runtime**. It verifies that
`/var/run/docker.sock`, `/run/docker.sock`, unrelated host-file canaries, synthetic
private-evaluator canaries, and repository paths are absent or inaccessible.
Host-only environment variables are absent, effective Linux capabilities are zero,
and `no-new-privileges` is enabled. Both phases passed. No actual private evaluator
or secret was read by the test.

Only copied source is bound into the build. Runtime receives copied source and
fixture files read-only plus a fresh writable data directory. The host repository,
Docker socket and private evaluator are never mounted. Candidates do not inherit
the host Docker supplementary group. The integration suite verifies result and
resource cleanup on both successful and intentionally faulty evaluations.

These checks establish the tested file/mount boundary, not protection against
kernel vulnerabilities or every possible host service. Containers share the host
kernel, and an internal bridge is not a complete host-service firewall. Do not
expose a Docker TCP API, private evaluator service, credentials or other sensitive
host services to candidate-reachable networks. Images are operator-trusted;
build/data disk writes lack quotas; controller death or daemon outage may leave
resources. Remote/rootless Docker, Windows and hostile-code isolation remain
unverified. The default-network build exception is opt-in and was not used here.

Under these documented Milestone 1 limits, fixture determinism, isolated reference
execution, public HTTP assertions, faulty-candidate classification, validated
JSON/SQLite persistence, latest reporting, cleanup and the full automated suite
are now verified. No saturation workload, hidden evaluator, dashboard or SlopShop
business logic was added.
