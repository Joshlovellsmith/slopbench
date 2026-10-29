import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomWord, simulateSmall } from "../benchmark/oracle/simulation";
import { products, validateSchema } from "../benchmark/tests/public/support";
import { generate, verify } from "../src/fixtures";
import { productSchema } from "../src/schemas";

test("Round 0 fixtures reuse v1 bytes and support empty initialization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sb-round0-fixtures-"));
  try {
    for (const [profile, counts] of Object.entries({
      public: { products: 12, customers: 4 },
      empty: { products: 0, customers: 0 },
    })) {
      const generated = await generate(join(dir, profile), 12345, counts);
      expect(await verify(`benchmark/fixtures/${profile}`)).toEqual(generated);
      for (const name of ["products.jsonl", "customers.jsonl", "manifest.json"])
        expect(await Bun.file(join(dir, profile, name)).text()).toBe(
          await Bun.file(`benchmark/fixtures/${profile}/${name}`).text(),
        );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("OpenAPI response schema checks reject missing/null/fractional/extra fields", () => {
  validateSchema("Product", productSchema.parse(products[0]));
  for (const change of [
    { inventory: null },
    { priceMinor: 1.5 },
    { extra: true },
    { name: "" },
    { sku: "lowercase" },
  ])
    expect(() =>
      validateSchema("Product", { ...products[0], ...change }),
    ).toThrow();
  validateSchema("Error409", {
    error: {
      code: "INSUFFICIENT_STOCK",
      message: "Not enough stock",
      line: null,
    },
  });
  expect(() =>
    validateSchema("Error409", {
      error: { code: "INVALID_JSON", message: "wrong status", line: null },
    }),
  ).toThrow();
});
test(
  "public HTTP adapter runs against fixed response fixtures and rejects bad responses",
  async () => {
    // This is a three-response transport fixture, not an implementation of SlopShop.
    let broken = false;
    const paths: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (path === "/health") return Response.json({ status: "ok" });
        return new Response(
          JSON.stringify({
            items: products,
            total: 12,
            limit: broken ? 0 : 20,
            offset: 0,
          }).replace('"inventory":0', '"inventory":-0'),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      for (const expectedCode of [0, 1]) {
        broken = expectedCode === 1;
        const env: Record<string, string | undefined> = {
          ...process.env,
          ROUND0_DOMAIN: "catalogue",
          ROUND0_BASE_URL: server.url.toString().replace(/\/$/, ""),
        };
        delete env.ROUND0_TARGETS;
        const child = Bun.spawn(
          [
            process.execPath,
            "test",
            "benchmark/tests/public/catalogue.test.ts",
            "--test-name-pattern",
            "^CAT-defaults",
          ],
          { env, stdout: "pipe", stderr: "pipe" },
        );
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, `${stdout}\n${stderr}`).toBe(expectedCode);
        if (broken) expect(`${stdout}${stderr}`).toContain("ProductPage");
      }
      expect(paths).toContain("/health");
      expect(paths).toContain("/products");
    } finally {
      server.stop(true);
    }
  },
  { timeout: 30000 },
);
test("numerical analytical examples and oracle guard", () => {
  expect(randomWord(0, 0, 0, 0)).toBe(4265067157);
  const input = {
    seed: 2,
    days: 2,
    scenarios: 1,
    products: [
      {
        productId: "p-00000002",
        initialStock: 0,
        demandMax: 1,
        reorderPoint: 0,
        replenishmentQuantity: 1,
        leadDays: 1,
      },
    ],
  };
  expect(simulateSmall(input).items[0]).toEqual({
    productId: "p-00000002",
    demandedUnits: 2,
    soldUnits: 1,
    lostUnits: 1,
    replenishedUnits: 1,
    stockoutDays: 1,
    endingStockUnitsSum: 0,
    meanEndingStockMilli: 0,
    fillRateBps: 5000,
  });
  expect(() => simulateSmall({ ...input, scenarios: 1000000 })).toThrow(
    "restricted",
  );
});

test("every success response schema accepts explicit contract fixtures", () => {
  const input = {
    seed: 0,
    days: 2,
    scenarios: 2,
    products: [
      {
        productId: "p-00000002",
        initialStock: 3,
        demandMax: 0,
        reorderPoint: 0,
        replenishmentQuantity: 0,
        leadDays: 1,
      },
    ],
  };
  const request = {
    id: "o-example",
    customerId: "c-00000002",
    orderedAt: "2024-01-01T00:00:00.000Z",
    items: [{ productId: "p-00000002", quantity: 1 }],
  };
  const fixtures: { schema: string; body: unknown }[] = [
    { schema: "Health", body: { status: "ok" } },
    { schema: "Product", body: products[0] },
    {
      schema: "ProductPage",
      body: { items: products, total: 12, limit: 20, offset: 0 },
    },
    { schema: "Inventory", body: { productId: "p-00000002", quantity: 178 } },
    { schema: "OrderRequest", body: request },
    {
      schema: "Order",
      body: {
        ...request,
        status: "confirmed",
        items: [
          {
            productId: "p-00000002",
            category: "clothing",
            quantity: 1,
            unitPriceMinor: 99999999,
            lineTotalMinor: 99999999,
          },
        ],
        totalMinor: 99999999,
      },
    },
    {
      schema: "Revenue",
      body: {
        groupBy: "product",
        items: [{ key: "p-00000002", quantity: 1, revenueMinor: 99999999 }],
      },
    },
    {
      schema: "Revenue",
      body: {
        groupBy: "category",
        items: [{ key: "clothing", quantity: 1, revenueMinor: 99999999 }],
      },
    },
    {
      schema: "TopProducts",
      body: {
        items: [
          { productId: "p-00000002", quantity: 1, revenueMinor: 99999999 },
        ],
      },
    },
    { schema: "ImportResult", body: { imported: 0 } },
    { schema: "SimulationRequest", body: input },
    { schema: "SimulationResult", body: simulateSmall(input) },
  ];
  for (const fixture of fixtures)
    expect(
      () => validateSchema(fixture.schema, fixture.body),
      fixture.schema,
    ).not.toThrow();
  expect(() =>
    validateSchema("Product", { ...products[0], id: "p-00000001\n" }),
  ).toThrow();
  expect(() =>
    validateSchema("Product", { ...products[0], sku: "SKU-01\n" }),
  ).toThrow();
  expect(() =>
    validateSchema("Revenue", {
      groupBy: "category",
      items: [{ key: "p-00000002", quantity: 1, revenueMinor: 1 }],
    }),
  ).toThrow();
});
