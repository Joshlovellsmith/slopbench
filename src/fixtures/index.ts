import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  customerSchema,
  fixtureManifestSchema,
  productSchema,
} from "../schemas";
export const profiles = {
  small: { products: 1000, customers: 200 },
  medium: { products: 100000, customers: 10000 },
  large: { products: 1000000, customers: 100000 },
} as const;
// Numerical Recipes LCG: unsigned 32-bit arithmetic, no floating transcendental functions.
export function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}
export const serialize = (value: unknown) => `${JSON.stringify(value)}\n`;
export async function shaFile(path: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest("hex");
}
export async function* records(path: string) {
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (!line) throw new Error(`Empty fixture line: ${path}`);
      yield JSON.parse(line) as unknown;
    }
  } finally {
    lines.close();
  }
}
export async function generate(
  dir: string,
  seed: number,
  counts: { products: number; customers: number },
) {
  fixtureManifestSchema.shape.seed.parse(seed);
  for (const n of Object.values(counts))
    if (!Number.isSafeInteger(n) || n < 0 || n > 10000000)
      throw new Error("Counts must be integers between 0 and 10000000");
  await mkdir(dir, { recursive: true });
  const rand = prng(seed);
  const categories = ["books", "home", "electronics", "clothing"] as const;
  for (const kind of ["products", "customers"] as const) {
    const f = await open(join(dir, `${kind}.jsonl`), "w");
    try {
      for (let i = 0; i < counts[kind]; i++) {
        const n = i + 1;
        const id = String(n).padStart(8, "0");
        const a = rand() % 1000;
        const b = rand() % 1000;
        const record =
          kind === "products"
            ? productSchema.parse({
                id: `p-${id}`,
                sku: `SKU-${id}`,
                name: i === 0 ? "Boundary product: café ☕" : `Product ${id}`,
                category: categories[rand() % 4],
                priceMinor:
                  i === 0
                    ? 0
                    : i === 1
                      ? 99999999
                      : 100 + Math.floor((a * a * b) / 10000),
                inventory: i === 0 ? 0 : rand() % 200,
                status: i % 17 === 0 ? "discontinued" : "active",
                popularityWeight: Math.max(1, Math.floor(1000000 / n)),
              })
            : customerSchema.parse({
                id: `c-${id}`,
                name: i === 0 ? "Zoë Boundary" : `Customer ${id}`,
                email: `customer${id}@example.test`,
                registeredAt: new Date(
                  1577836800000 + (rand() % 157680000) * 1000,
                ).toISOString(),
                active: i % 13 !== 0,
              });
        await f.write(serialize(record));
      }
    } finally {
      await f.close();
    }
  }
  const manifest = fixtureManifestSchema.parse({
    schemaVersion: "1",
    generatorVersion: "1",
    seed,
    counts,
    files: {
      "products.jsonl": await shaFile(join(dir, "products.jsonl")),
      "customers.jsonl": await shaFile(join(dir, "customers.jsonl")),
    },
  });
  await Bun.write(join(dir, "manifest.json"), serialize(manifest));
  return manifest;
}
export async function verify(dir: string) {
  const manifest = fixtureManifestSchema.parse(
    JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")),
  );
  for (const kind of ["products", "customers"] as const) {
    const name = `${kind}.jsonl` as const;
    if ((await shaFile(join(dir, name))) !== manifest.files[name])
      throw new Error(`Hash mismatch: ${name}`);
    let n = 0;
    for await (const record of records(join(dir, name))) {
      const parsed = (
        kind === "products" ? productSchema : customerSchema
      ).parse(record);
      n++;
      if (
        parsed.id !==
        `${kind === "products" ? "p" : "c"}-${String(n).padStart(8, "0")}`
      )
        throw new Error(`Invalid order/id: ${name}`);
    }
    if (n !== manifest.counts[kind]) throw new Error(`Count mismatch: ${name}`);
  }
  return manifest;
}
