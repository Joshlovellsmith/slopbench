import { expect } from "bun:test";
import { type Order, order, product, suite, validateSchema } from "./support";

const { publicTest, request, error, stock, importProducts, control, target } =
  suite("orders");
publicTest(
  "ORD-create-and-get",
  ["ORD-001", "ORD-003", "ORD-005"],
  async () => {
    const payload = order("o-public-create", [
      { productId: "p-00000003", quantity: 2 },
      { productId: "p-00000002", quantity: 1 },
    ]);
    const before = await stock("p-00000003");
    const r = await request<Order>("POST", "/orders", {
      json: payload,
      status: 201,
    });
    expect(r.headers.get("location")).toBe("/orders/o-public-create");
    expect(r.body).toEqual({
      id: payload.id,
      customerId: payload.customerId,
      orderedAt: payload.orderedAt,
      status: "confirmed",
      items: [
        {
          productId: "p-00000002",
          category: "clothing",
          quantity: 1,
          unitPriceMinor: 99999999,
          lineTotalMinor: 99999999,
        },
        {
          productId: "p-00000003",
          category: "clothing",
          quantity: 2,
          unitPriceMinor: 6430,
          lineTotalMinor: 12860,
        },
      ],
      totalMinor: 100012859,
    });
    expect((await request("GET", "/orders/o-public-create")).body).toEqual(
      r.body,
    );
    expect(await stock("p-00000003")).toBe(before - 2);
    await error("POST", "/orders", { json: payload }, 409, "ORDER_EXISTS");
    await error(
      "POST",
      "/orders",
      { json: { ...payload, customerId: "c-88888888" } },
      409,
      "ORDER_EXISTS",
    );
    expect(await stock("p-00000003")).toBe(before - 2);
  },
);
publicTest("ORD-invalid-items", ["ORD-001", "GEN-001"], async () => {
  for (const items of [
    [],
    [{ productId: "p-00000002", quantity: 0 }],
    [{ productId: "p-00000002", quantity: 1.5 }],
    [
      { productId: "p-00000002", quantity: 1 },
      { productId: "p-00000002", quantity: 2 },
    ],
    Array.from({ length: 101 }, (_, i) => ({
      productId: `p-${String(100 + i).padStart(8, "0")}`,
      quantity: 1,
    })),
  ])
    await error(
      "POST",
      "/orders",
      { json: order("o-invalid-items", items) },
      400,
      "VALIDATION_ERROR",
    );
  await error(
    "POST",
    "/orders",
    {
      json: {
        ...order("o-invalid-null", [{ productId: "p-00000002", quantity: 1 }]),
        customerId: null,
      },
    },
    400,
    "VALIDATION_ERROR",
  );
});
publicTest("ORD-references-and-priority", ["ORD-002", "GEN-004"], async () => {
  const line = [{ productId: "p-00000002", quantity: 1 }];
  await error(
    "POST",
    "/orders",
    { json: order("o-missing-customer", line, { customerId: "c-88888888" }) },
    404,
    "CUSTOMER_NOT_FOUND",
  );
  await error(
    "POST",
    "/orders",
    { json: order("o-inactive-customer", line, { customerId: "c-00000001" }) },
    409,
    "CUSTOMER_INACTIVE",
  );
  await error(
    "POST",
    "/orders",
    {
      json: order("o-missing-product", [
        { productId: "p-88888888", quantity: 1 },
      ]),
    },
    404,
    "PRODUCT_NOT_FOUND",
  );
  await error(
    "POST",
    "/orders",
    {
      json: order("o-inactive-product", [
        { productId: "p-00000001", quantity: 1 },
      ]),
    },
    409,
    "PRODUCT_INACTIVE",
  );
  await error("GET", "/orders/o-not-created", {}, 404, "ORDER_NOT_FOUND");
  await error("GET", "/orders/invalid", {}, 400, "VALIDATION_ERROR");
});
publicTest("ORD-rollback-and-retry", ["ORD-004", "ORD-005"], async () => {
  const before = await stock("p-00000004");
  await error(
    "POST",
    "/orders",
    {
      json: order("o-rollback", [
        { productId: "p-00000004", quantity: 2 },
        { productId: "p-00000012", quantity: 11 },
      ]),
    },
    409,
    "INSUFFICIENT_STOCK",
  );
  expect(await stock("p-00000004")).toBe(before);
  expect(await stock("p-00000012")).toBe(10);
  await error("GET", "/orders/o-rollback", {}, 404, "ORDER_NOT_FOUND");
  await request("POST", "/orders", {
    json: order("o-rollback", [{ productId: "p-00000004", quantity: 1 }]),
    status: 201,
  });
});
publicTest("ORD-concurrent-stock", ["ORD-004", "INV-003"], async () => {
  await request("POST", "/inventory/p-00000005/adjustments", {
    json: { delta: 5 - (await stock("p-00000005")) },
  });
  const outcomes = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const r = await fetch(`${target!.url}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          order(`o-race-${i}`, [{ productId: "p-00000005", quantity: 1 }]),
        ),
        signal: AbortSignal.timeout(10000),
      });
      const body = await r.json();
      validateSchema(r.status === 201 ? "Order" : `Error${r.status}`, body);
      return { status: r.status, body };
    }),
  );
  expect(outcomes.filter((r) => r.status === 201)).toHaveLength(5);
  expect(outcomes.filter((r) => r.status === 409)).toHaveLength(5);
  for (const r of outcomes.filter((r) => r.status === 409))
    expect(r.body).toMatchObject({ error: { code: "INSUFFICIENT_STOCK" } });
  expect(await stock("p-00000005")).toBe(0);
});
publicTest("ORD-concurrent-id", ["ORD-005"], async () => {
  const before = await stock("p-00000006");
  const payload = order("o-same-id", [
    { productId: "p-00000006", quantity: 1 },
  ]);
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      fetch(`${target!.url}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      }),
    ),
  );
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(responses.filter((r) => r.status === 409)).toHaveLength(3);
  for (const response of responses) {
    const body = await response.json();
    validateSchema(response.status === 201 ? "Order" : "Error409", body);
    if (response.status === 409)
      expect(body).toMatchObject({ error: { code: "ORDER_EXISTS" } });
  }
  expect(await stock("p-00000006")).toBe(before - 1);
});
publicTest("ORD-zero-and-numeric-limit", ["ORD-003", "ORD-004"], async () => {
  const zero = product("p-93000001", { priceMinor: 0 });
  const costly = Array.from({ length: 10 }, (_, i) =>
    product(`p-${93000010 + i}`, {
      priceMinor: 1000000000,
      inventory: 1000000,
    }),
  );
  await importProducts([zero, ...costly]);
  expect(
    (
      await request<Order>("POST", "/orders", {
        json: order("o-free", [{ productId: zero.id, quantity: 2 }]),
        status: 201,
      })
    ).body.totalMinor,
  ).toBe(0);
  await error(
    "POST",
    "/orders",
    {
      json: order(
        "o-too-costly",
        costly.map((p) => ({ productId: p.id, quantity: 1000000 })),
      ),
    },
    409,
    "NUMERIC_LIMIT",
  );
  for (const p of costly) expect(await stock(p.id)).toBe(1000000);
});
publicTest("ORD-dates", ["GEN-001", "ORD-001"], async () => {
  for (const orderedAt of [
    "2024-01-01T00:00:00Z",
    "2024-01-01T01:00:00.000+01:00",
    "2023-02-29T00:00:00.000Z",
    "2100-01-01T00:00:00.000Z",
  ])
    await error(
      "POST",
      "/orders",
      {
        json: order("o-date", [{ productId: "p-00000007", quantity: 1 }], {
          orderedAt,
        }),
      },
      400,
      "VALIDATION_ERROR",
    );
});
publicTest(
  "ORD-restart-durability",
  ["DATA-002", "ORD-005"],
  async () => {
    const r = await request<Order>("POST", "/orders", {
      json: order("o-durable", [{ productId: "p-00000008", quantity: 1 }]),
      status: 201,
    });
    const quantity = await stock("p-00000008");
    await control("restart");
    expect((await request("GET", "/orders/o-durable")).body).toEqual(r.body);
    expect(await stock("p-00000008")).toBe(quantity);
  },
  "control",
);
publicTest(
  "ORD-storage-rollback",
  ["GEN-002", "ORD-004"],
  async () => {
    const before = await stock("p-00000009");
    try {
      await control("storage-failure-on");
      await error(
        "POST",
        "/orders",
        {
          json: order("o-storage-failure", [
            { productId: "p-00000009", quantity: 1 },
          ]),
        },
        503,
        "STORAGE_UNAVAILABLE",
      );
    } finally {
      await control("storage-failure-off");
    }
    expect(await stock("p-00000009")).toBe(before);
    await error("GET", "/orders/o-storage-failure", {}, 404, "ORDER_NOT_FOUND");
  },
  "control",
);
