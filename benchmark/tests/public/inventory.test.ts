import { expect } from "bun:test";
import {
  type Inventory,
  type Page,
  parseJSON,
  suite,
  validateSchema,
} from "./support";

const { publicTest, request, error, stock, target } = suite("inventory");
publicTest(
  "INV-read-and-adjust",
  ["INV-001", "INV-002", "CAT-004"],
  async () => {
    expect(await stock("p-00000002")).toBe(178);
    expect(
      (
        await request<Inventory>("POST", "/inventory/p-00000002/adjustments", {
          json: { delta: 2 },
        })
      ).body.quantity,
    ).toBe(180);
    expect((await request("GET", "/products/p-00000002")).body).toMatchObject({
      inventory: 180,
    });
    expect(
      (
        await request<Inventory>("POST", "/inventory/p-00000002/adjustments", {
          json: { delta: 0 },
        })
      ).body.quantity,
    ).toBe(180);
  },
);
publicTest("INV-boundaries", ["INV-002"], async () => {
  await request("POST", "/inventory/p-00000003/adjustments", {
    json: { delta: -190 },
  });
  await error(
    "POST",
    "/inventory/p-00000003/adjustments",
    { json: { delta: -1 } },
    409,
    "INSUFFICIENT_STOCK",
  );
  expect(await stock("p-00000003")).toBe(0);
  await request("POST", "/inventory/p-00000003/adjustments", {
    json: { delta: 1000000000 },
  });
  await error(
    "POST",
    "/inventory/p-00000003/adjustments",
    { json: { delta: 1 } },
    409,
    "INVENTORY_LIMIT",
  );
  expect(await stock("p-00000003")).toBe(1000000000);
  await request("POST", "/inventory/p-00000001/adjustments", {
    json: { delta: 1 },
  });
  expect(await stock("p-00000001")).toBe(1);
});
publicTest("INV-race", ["INV-003", "GEN-004"], async () => {
  await request("POST", "/inventory/p-00000004/adjustments", {
    json: { delta: -77 },
  });
  const outcomes = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const response = await fetch(
        `${target!.url}/inventory/p-00000004/adjustments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"delta":-1}',
          signal: AbortSignal.timeout(10000),
        },
      );
      return {
        status: response.status,
        body: parseJSON(await response.text()),
      };
    }),
  );
  for (const outcome of outcomes)
    validateSchema(
      outcome.status === 200 ? "Inventory" : "Error409",
      outcome.body,
    );
  expect(
    outcomes
      .filter((r) => r.status === 200)
      .map((r) => (r.body as Inventory).quantity)
      .sort((a, b) => a - b),
  ).toEqual([0, 1, 2, 3, 4]);
  expect(outcomes.filter((r) => r.status === 200)).toHaveLength(5);
  expect(outcomes.filter((r) => r.status === 409)).toHaveLength(5);
  for (const r of outcomes.filter((r) => r.status === 409))
    expect(r.body).toMatchObject({
      error: { code: "INSUFFICIENT_STOCK", line: null },
    });
  expect(await stock("p-00000004")).toBe(0);
  const page = await request<Page>("GET", "/products");
  expect(page.body.items.find((p) => p.id === "p-00000004")?.inventory).toBe(0);
});
publicTest("INV-validation", ["INV-001", "INV-002", "GEN-001"], async () => {
  for (const body of [
    { delta: 1.5 },
    { Delta: 1 },
    { delta: null },
    { delta: "1" },
    { delta: 1000000001 },
    { delta: 1, extra: true },
    {},
  ])
    await error(
      "POST",
      "/inventory/p-00000005/adjustments",
      { json: body },
      400,
      "VALIDATION_ERROR",
    );
  await error("GET", "/inventory/p-88888888", {}, 404, "PRODUCT_NOT_FOUND");
  await error(
    "POST",
    "/inventory/bad/adjustments",
    { json: { delta: 1 } },
    400,
    "VALIDATION_ERROR",
  );
  expect(await stock("p-00000005")).toBe(86);
});
publicTest("INV-wire-errors", ["GEN-001", "GEN-002", "GEN-003"], async () => {
  await error(
    "POST",
    "/inventory/p-00000006/adjustments",
    { raw: '{"delta":1,"delta":2}' },
    400,
    "INVALID_JSON",
  );
  await error(
    "POST",
    "/inventory/p-00000006/adjustments",
    { raw: '{"delta":' },
    400,
    "INVALID_JSON",
  );
  await error(
    "POST",
    "/inventory/p-00000006/adjustments",
    { raw: '{"delta":1}', contentType: "text/plain" },
    415,
    "UNSUPPORTED_MEDIA_TYPE",
  );
  await error(
    "POST",
    "/inventory/p-00000006/adjustments",
    { raw: " ".repeat(1048577) },
    413,
    "INPUT_LIMIT",
  );
  expect(
    (
      await request<Inventory>("POST", "/inventory/p-00000006/adjustments", {
        raw: '{"delta":1.0}',
      })
    ).body.quantity,
  ).toBe(83);
});
