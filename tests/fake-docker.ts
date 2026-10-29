export {};
// Test transport only: records Docker operations; never runs candidate commands.
const args = process.argv.slice(2);
const op = args[0];
await Bun.write(
  process.env.SB_CALLS!,
  `${await Bun.file(process.env.SB_CALLS!)
    .text()
    .catch(() => "")}${JSON.stringify(args)}\n`,
);
const failure = process.env.SB_FAILURE;
if (failure === "infra" && op === "version") {
  console.error("daemon unavailable");
  process.exit(1);
}
if (failure === "build" && op === "run" && !args.includes("-d")) {
  console.error("compiler failed");
  process.exit(1);
}
if (op === "version") console.log("test-daemon");
if (op === "image") console.log("sha256:test-image");
if (op === "run") console.log("test-container");
if (op === "network" && args[1] === "create") console.log("test-network");
if (op === "inspect")
  console.log(
    JSON.stringify([
      {
        NetworkSettings: {
          Networks: { [`${args[1]}-net`]: { IPAddress: "127.0.0.1" } },
        },
        State: {
          Running:
            failure !== "startup" &&
            failure !== "oom" &&
            !(
              failure === "runtime" &&
              (await Bun.file(process.env.SB_CALLS!).text())
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line) as string[])
                .filter((call) => call[0] === "inspect").length > 2
            ),
          ExitCode: 0,
          OOMKilled: failure === "oom",
        },
      },
    ]),
  );
if (op === "logs") {
  console.log("candidate stdout");
  console.error("candidate stderr");
}
