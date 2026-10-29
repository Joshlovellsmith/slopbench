import { createHash } from "node:crypto";
import { join } from "node:path";
import { command } from "../../src/runner";

export interface Instance {
  name: string;
  data: string;
  url: string;
  fixture: string;
  network: string;
}
export async function isolationAudit(
  instance: Instance,
  privateCanary: string,
  controlPort: number,
  otherUrl: string,
) {
  const info = JSON.parse(await command(["inspect", instance.name]))[0];
  if (
    info.Mounts.length !== 3 ||
    info.Mounts.some(
      (m: { Destination: string }) =>
        !["/workspace", "/fixtures", "/data"].includes(m.Destination),
    )
  )
    throw new Error("Unexpected candidate mounts");
  if (
    info.HostConfig.Privileged ||
    info.HostConfig.PidMode === "host" ||
    info.HostConfig.ReadonlyRootfs !== true ||
    info.Config.User !== `${process.getuid?.()}:${process.getgid?.()}`
  )
    throw new Error("Unsafe runtime isolation settings");
  const net = JSON.parse(
    await command(["network", "inspect", instance.network]),
  )[0];
  if (
    !net.Internal ||
    Object.keys(info.HostConfig.PortBindings ?? {}).length !== 0
  )
    throw new Error("Unexpected network exposure");
  const probe = `
    const fs=await import('node:fs');
    const forbidden=${JSON.stringify(["/var/run/docker.sock", "/run/docker.sock", "/home/admin/projects/slopbench/README.md", privateCanary])};
    for(const p of forbidden) {if(fs.existsSync(p)) throw new Error('Forbidden path accessible: '+p);}
    for(const p of ['/workspace/candidate.json','/fixtures/manifest.json']) {
      let writable=false;try {const fd=fs.openSync(p,'r+');fs.closeSync(fd);writable=true;}catch{}
      if(writable) throw new Error('Input mount is writable: '+p);
    }
    let writableRoot=false;try {fs.writeFileSync('/isolation-probe','x');writableRoot=true;}catch{}
    if(writableRoot) throw new Error('Writable root filesystem');
    if(process.getgroups().includes(987)) throw new Error('Inherited host Docker group');
    fs.writeFileSync('/data/isolation-probe','ok');fs.unlinkSync('/data/isolation-probe');
    for(const url of ${JSON.stringify([`http://127.0.0.1:${controlPort}/restart`, otherUrl, `http://${net.IPAM.Config[0].Gateway}:${controlPort}/restart`])}) {
      let accessible=false;try {const r=await fetch(url,{signal:AbortSignal.timeout(300)});await r.body?.cancel();accessible=true;}catch{}
      if(accessible) throw new Error('Evaluator or unrelated instance accessible: '+url);
    }
    console.log(JSON.stringify({forbiddenPathsAbsent:true,readOnlyInputs:true,readOnlyRoot:true,writableData:true,groups:process.getgroups(),controllerAndOtherInstanceInaccessible:true}));
  `;
  return JSON.parse(await command(["exec", instance.name, "bun", "-e", probe]));
}
export async function fixtureBindingAudit(instance: Instance) {
  const path = join(instance.fixture, "manifest.json"),
    original = await Bun.file(path).text(),
    manifest = JSON.parse(original);
  const hash = async () =>
    createHash("sha256")
      .update(
        new Uint8Array(
          await Bun.file(join(instance.data, "candidate.sqlite")).arrayBuffer(),
        ),
      )
      .digest("hex");
  await command(["stop", "--time", "3", instance.name]);
  const before = await hash();
  try {
    await Bun.write(
      path,
      JSON.stringify({ ...manifest, seed: (manifest.seed + 1) >>> 0 }),
    );
    await command(["start", instance.name]);
    const exit = await command(["wait", instance.name], 10000);
    if (exit === "0")
      throw new Error("Mismatched fixture unexpectedly accepted");
    if ((await hash()) !== before)
      throw new Error("Mismatched fixture mutated the bound database");
    // Equivalent parsed manifest with reverse key ordering and whitespace must work.
    await Bun.write(
      path,
      JSON.stringify(
        Object.fromEntries(Object.entries(manifest).reverse()),
        null,
        4,
      ),
    );
    await command(["start", instance.name]);
    // Keep the equivalent representation in place until readiness proves that
    // startup read it. Restoring immediately after `docker start` races startup.
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`${instance.url}/health`, {
          signal: AbortSignal.timeout(300),
        });
        if (
          response.status === 200 &&
          (await response.json()).status === "ok"
        ) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(50);
    }
    if (!ready)
      throw new Error("Equivalent parsed fixture manifest was rejected");
  } finally {
    await Bun.write(path, original);
  }
  return {
    changedManifestRejected: true,
    databaseUnchanged: true,
    equivalentManifestAccepted: true,
  };
}

// Raw HTTP preserves dot/percent segments that Fetch's URL parser normalizes.
export async function wireAudit(base: string) {
  const { createConnection } = await import("node:net");
  async function raw(
    target: string,
    expected: number,
    method = "GET",
    body = Buffer.alloc(0),
    extra: Record<string, string> = {},
  ) {
    const url = new URL(base);
    const status = await new Promise<number>((resolve, reject) => {
      let response = "";
      const socket = createConnection(
        { host: url.hostname, port: Number(url.port) },
        () => {
          socket.write(
            `${method} ${target} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\nContent-Length: ${body.length}\r\n${Object.entries(
              extra,
            )
              .map(([k, v]) => `${k}: ${v}\r\n`)
              .join("")}\r\n`,
          );
          socket.write(body);
        },
      );
      socket.setTimeout(5000, () =>
        socket.destroy(new Error("Raw HTTP audit timeout")),
      );
      socket.on("data", (chunk) => {
        response += chunk.toString();
        if (response.length > 65536)
          socket.destroy(new Error("Oversized raw response"));
      });
      socket.on("error", reject);
      socket.on("end", () =>
        resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(response)?.[1])),
      );
    });
    if (status !== expected)
      throw new Error(
        `Wire audit ${method} ${target}: expected ${expected}, got ${status}`,
      );
  }
  await raw("/products/../health", 404);
  await raw("/products/%2e%2e/health", 404);
  await raw("/products%2fanything", 400);
  await raw("/products/p-%ZZ", 400);
  await raw("/products?limit=%FF", 400);
  await raw("/health", 200, "GET", Buffer.from("not JSON"), {
    "Content-Type": "text/plain",
    "Content-Encoding": "gzip",
  });
  const route = "/inventory/p-00000002/adjustments";
  await raw(route, 400, "POST", Buffer.from('{"delta":0,"d\\u0065lta":1}'), {
    "Content-Type": "application/json",
  });
  await raw(route, 400, "POST", Buffer.from('{"delta":"\\ud800"}'), {
    "Content-Type": "application/json",
  });
  await raw(
    route,
    400,
    "POST",
    Buffer.from([123, 34, 100, 101, 108, 116, 97, 34, 58, 34, 255, 34, 125]),
    { "Content-Type": "application/json" },
  );
  const json = '{"delta":0}',
    boundary = Buffer.from(" ".repeat(1048576 - json.length) + json);
  await raw(route, 200, "POST", boundary, {
    "Content-Type": ' Application/JSON ; charset = "UTF-8"',
  });
  await raw(route, 413, "POST", Buffer.concat([boundary, Buffer.from(" ")]), {
    "Content-Type": "application/json",
  });
  // Leave chunked bodies open after an observed error: responses must not wait
  // for EOF or lose their JSON envelope when cancelling an input iterator.
  async function early(
    path: string,
    chunk: Buffer,
    expected: number,
    code: string,
  ) {
    const url = new URL(base);
    await new Promise<void>((resolve, reject) => {
      let response = "",
        settled = false;
      const socket = createConnection(
        { host: url.hostname, port: Number(url.port) },
        () => {
          socket.write(
            `POST ${path} HTTP/1.1\r\nHost: ${url.host}\r\nTransfer-Encoding: chunked\r\nContent-Type: ${path.startsWith("/imports") ? "application/x-ndjson" : "application/json"}\r\nConnection: close\r\n\r\n${chunk.length.toString(16)}\r\n`,
          );
          socket.write(chunk);
          socket.write("\r\n");
        },
      );
      socket.setTimeout(5000, () =>
        socket.destroy(new Error("Early rejection waited for body EOF")),
      );
      socket.on("data", (chunk) => {
        response += chunk.toString();
        if (response.includes(`"code":"${code}"`)) {
          settled = true;
          const status = Number(/^HTTP\/1\.1 (\d+)/.exec(response)?.[1]);
          socket.destroy();
          if (status === expected) resolve();
          else reject(new Error(`Early rejection status ${status}`));
        }
      });
      socket.on("error", reject);
      socket.on("close", () => {
        if (!settled)
          reject(new Error(`Early rejection lost JSON response: ${response}`));
      });
    });
  }
  await early(
    "/imports/products",
    Buffer.from("{}\n"),
    400,
    "VALIDATION_ERROR",
  );
  await early(
    "/imports/products",
    Buffer.from(" ".repeat(4097)),
    413,
    "INPUT_LIMIT",
  );
  await early(route, Buffer.from(" ".repeat(1048577)), 413, "INPUT_LIMIT");
  return {
    rawCases: 14,
    pathDecoding: true,
    ignoredGetEntity: true,
    strictJson: true,
    bodyBoundaryBytes: 1048576,
  };
}
