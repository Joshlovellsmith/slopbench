// Public integration probe copied into a disposable candidate by docker.test.ts.
import { access, readFile } from "node:fs/promises";

const paths = (await Bun.file("probe-paths.json").json()) as string[];
for (const path of paths) {
  let visible = true;
  try {
    await access(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "EACCES") throw error;
    visible = false;
  }
  if (visible)
    throw new Error(`Host resource visible inside candidate: ${path}`);
}
if (process.env.SLOPBENCH_HOST_ONLY_CANARY !== undefined)
  throw new Error("Host environment leaked");
const status = await readFile("/proc/self/status", "utf8");
if (!/^CapEff:\s+0+$/m.test(status) || !/^NoNewPrivs:\s+1$/m.test(status))
  throw new Error("Container security flags missing");
console.log(
  JSON.stringify({
    isolationProbe: "passed",
    phase: process.argv[2] ?? "build",
    checkedPaths: paths,
    uid: process.getuid?.(),
    groups: process.getgroups?.(),
  }),
);
if (process.argv[2] === "serve") await import(String("./server.ts"));
