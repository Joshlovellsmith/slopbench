import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const excluded = new Set([".git", "node_modules"]);
export async function snapshot(source: string, destination?: string) {
  const root = resolve(source);
  const h = createHash("sha256");
  async function walk(relative: string) {
    const entries = await readdir(join(root, relative));
    entries.sort();
    for (const name of entries) {
      if (excluded.has(name)) continue;
      const path = join(relative, name);
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new Error(`Unsupported candidate file: ${path}`);
      if (stat.isDirectory()) {
        if (destination)
          await mkdir(join(destination, path), { recursive: true });
        await walk(path);
      } else {
        const bytes = await Bun.file(join(root, path)).arrayBuffer();
        h.update(
          JSON.stringify([
            path.split("\\").join("/"),
            stat.mode & 0o111,
            bytes.byteLength,
          ]),
        );
        h.update(new Uint8Array(bytes));
        if (destination) {
          await Bun.write(join(destination, path), bytes);
          await chmod(join(destination, path), stat.mode & 0o777);
        }
      }
    }
  }
  if (destination) await mkdir(destination, { recursive: true });
  await walk("");
  return h.digest("hex");
}
