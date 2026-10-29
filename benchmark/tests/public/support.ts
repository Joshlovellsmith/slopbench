import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { records, verify } from "../../../src/fixtures";
import { type Product, productSchema } from "../../../src/schemas";

export interface Target {
  url: string;
  emptyUrl?: string;
  controlUrl?: string;
}
const document = JSON.parse(
  readFileSync("benchmark/spec/openapi.yaml", "utf8"),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(document, "round0");
export function parseJSON(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) =>
    typeof value === "number" && value === 0 ? 0 : value,
  );
}
export function validateSchema(schema: string, value: unknown) {
  const validate = ajv.getSchema(`round0#/components/schemas/${schema}`);
  if (!validate) throw new Error(`Unknown response schema ${schema}`);
  if (!validate(value))
    throw new Error(
      `${schema}: ${ajv.errorsText(validate.errors, { separator: "; " })}; body=${JSON.stringify(value).slice(0, 2000)}`,
    );
}
export const products: Product[] = [];
for await (const p of records("benchmark/fixtures/public/products.jsonl"))
  products.push(productSchema.parse(p));
export const vectors = JSON.parse(
  readFileSync("benchmark/fixtures/simulation-vectors.json", "utf8"),
) as {
  schemaVersion: string;
  contractVersion: string;
  algorithm: string;
  randomWords: {
    seed: number;
    productOrdinal: number;
    scenario: number;
    day: number;
    word: number;
  }[];
  cases: {
    name: string;
    input: import("../../oracle/simulation").SimulationInput;
    expected: ReturnType<
      typeof import("../../oracle/simulation").simulateSmall
    >;
  }[];
};
export const windowQuery =
  "from=2024-01-01T00%3A00%3A00.000Z&to=2024-02-01T00%3A00%3A00.000Z";
export function product(id: string, changes: Partial<Product> = {}): Product {
  return {
    id,
    sku: `SKU-${id.slice(2)}`,
    name: `Public ${id}`,
    category: "books",
    priceMinor: 125,
    inventory: 10,
    status: "active",
    popularityWeight: 1,
    ...changes,
  };
}
export function order(
  id: string,
  items: { productId: string; quantity: number }[],
  changes: Record<string, unknown> = {},
) {
  return {
    id,
    customerId: "c-00000002",
    orderedAt: "2024-01-01T00:00:00.000Z",
    items,
    ...changes,
  };
}
export interface Order {
  id: string;
  customerId: string;
  orderedAt: string;
  status: "confirmed";
  items: {
    productId: string;
    category: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }[];
  totalMinor: number;
}
export interface Page {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}
export interface Inventory {
  productId: string;
  quantity: number;
}
export interface ErrorBody {
  error: { code: string; message: string; line: number | null };
}
function loadTarget(domain: string): Target | undefined {
  let target: Target | undefined;
  if (process.env.ROUND0_TARGETS)
    target = (
      JSON.parse(readFileSync(process.env.ROUND0_TARGETS, "utf8")) as Record<
        string,
        Target
      >
    )[domain];
  else if (process.env.ROUND0_DOMAIN === domain && process.env.ROUND0_BASE_URL)
    target = {
      url: process.env.ROUND0_BASE_URL,
      emptyUrl: process.env.ROUND0_EMPTY_URL,
      controlUrl: process.env.ROUND0_CONTROL_URL,
    };
  return target
    ? {
        url: target.url.replace(/\/+$/, ""),
        emptyUrl: target.emptyUrl?.replace(/\/+$/, ""),
        controlUrl: target.controlUrl?.replace(/\/+$/, ""),
      }
    : undefined;
}

export function suite(domain: string) {
  const target = loadTarget(domain);
  async function request<T = unknown>(
    method: string,
    path: string,
    options: {
      json?: unknown;
      raw?: BodyInit;
      contentType?: string;
      status?: number;
      schema?: string;
      empty?: boolean;
      headers?: Record<string, string>;
    } = {},
  ) {
    const base = options.empty ? target?.emptyUrl : target?.url;
    if (!base)
      throw new Error(
        `No ${domain} ${options.empty ? "empty " : ""}target configured`,
      );
    const headers: Record<string, string> = { ...options.headers };
    let body = options.raw;
    if ("json" in options) {
      body = JSON.stringify(options.json);
      headers["content-type"] = "application/json";
    } else if (body !== undefined)
      headers["content-type"] = options.contentType ?? "application/json";
    const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    const expected = options.status ?? 200;
    expect(
      response.status,
      `${method} ${path}: expected ${expected}, got ${response.status}: ${text.slice(0, 2000)}`,
    ).toBe(expected);
    expect(
      response.headers.get("content-type"),
      `${method} ${path} content type`,
    ).toMatch(/^application\/json(?:\s*;|$)/i);
    let data: unknown;
    try {
      data = parseJSON(text);
    } catch {
      throw new Error(
        `${method} ${path}: invalid JSON: ${text.slice(0, 1000)}`,
      );
    }
    const route = Object.keys(document.paths).find((route) =>
      new RegExp(`^${route.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(
        path.split("?")[0]!,
      ),
    );
    const schema =
      options.schema ??
      document.paths[route ?? ""]?.[method.toLowerCase()]?.responses[
        String(expected)
      ]?.content?.["application/json"]?.schema?.$ref
        ?.split("/")
        .at(-1) ??
      `Error${expected}`;
    validateSchema(schema, data);
    return { body: data as T, headers: response.headers };
  }
  async function error(
    method: string,
    path: string,
    options: {
      json?: unknown;
      raw?: BodyInit;
      contentType?: string;
      empty?: boolean;
      headers?: Record<string, string>;
    },
    status: number,
    code: string,
    line: number | null = null,
  ) {
    const result = await request<ErrorBody>(method, path, {
      ...options,
      status,
      schema: `Error${status}`,
    });
    expect(result.body.error.code, `${method} ${path} error code`).toBe(code);
    expect(result.body.error.line, `${method} ${path} error line`).toBe(line);
    return result;
  }
  async function importProducts(values: Product[]) {
    const r = await request<{ imported: number }>("POST", "/imports/products", {
      raw: `${values.map((p) => JSON.stringify(p)).join("\n")}\n`,
      contentType: "application/x-ndjson",
    });
    expect(r.body.imported).toBe(values.length);
  }
  async function stock(id: string) {
    return (await request<Inventory>("GET", `/inventory/${id}`)).body.quantity;
  }
  async function control(
    action: "restart" | "storage-failure-on" | "storage-failure-off",
  ) {
    if (!target?.controlUrl)
      throw new Error("External lifecycle controller is not configured");
    const r = await fetch(`${target.controlUrl.replace(/\/$/, "")}/${action}`, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
    });
    expect(r.status).toBe(204);
    if (action === "restart") {
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const ready = await fetch(`${target.url}/health`, {
            signal: AbortSignal.timeout(200),
          });
          if (ready.status === 200) return;
        } catch {}
        await Bun.sleep(50);
      }
      throw new Error("Candidate not ready after external restart");
    }
  }
  beforeAll(async () => {
    await verify("benchmark/fixtures/public");
    if (!target) return;
    const health = await request("GET", "/health");
    expect(health.body).toEqual({ status: "ok" });
    const page = await request<Page>("GET", "/products?limit=1000");
    expect(
      page.body.items,
      "Each domain requires a fresh seed-12345 12/4 database",
    ).toEqual(products);
    expect(page.body.total).toBe(12);
  });
  function publicTest(
    id: string,
    requirements: string[],
    run: () => Promise<void> | void,
    needs?: "empty" | "control" | "oracle",
  ) {
    const enabled =
      needs === "oracle" ||
      Boolean(
        target &&
          (needs !== "empty" || target.emptyUrl) &&
          (needs !== "control" || target.controlUrl),
      );
    (enabled ? test : test.skip)(
      `${id} [${requirements.join(",")}]${enabled ? "" : ` (requires ${needs ?? "candidate"} target)`}`,
      run,
      { timeout: 60000 },
    );
  }
  return { publicTest, request, error, importProducts, stock, control, target };
}
