import { expect } from "bun:test";
import { order, product, suite, windowQuery } from "./support";

const { publicTest, request, error, importProducts } = suite("analytics");
publicTest(
  "ANA-exact-aggregation",
  ["ANA-001", "ANA-002", "ANA-003"],
  async () => {
    const a = product("p-94000001"),
      b = product("p-94000002", { category: "home", priceMinor: 250 }),
      free = product("p-94000003", { priceMinor: 0 });
    await importProducts([a, b, free]);
    for (const [id, orderedAt, items] of [
      [
        "o-ana-before",
        "2023-12-31T23:59:59.999Z",
        [{ productId: a.id, quantity: 1 }],
      ],
      [
        "o-ana-from",
        "2024-01-01T00:00:00.000Z",
        [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 1 },
          { productId: free.id, quantity: 1 },
        ],
      ],
      [
        "o-ana-mid",
        "2024-01-02T00:00:00.000Z",
        [
          { productId: b.id, quantity: 1 },
          { productId: free.id, quantity: 1 },
        ],
      ],
      [
        "o-ana-to",
        "2024-02-01T00:00:00.000Z",
        [{ productId: a.id, quantity: 1 }],
      ],
    ] as const)
      await request("POST", "/orders", {
        json: order(id, [...items], { orderedAt }),
        status: 201,
      });
    expect(
      (
        await request(
          "GET",
          `/analytics/revenue?${windowQuery}&groupBy=product`,
        )
      ).body,
    ).toEqual({
      groupBy: "product",
      items: [
        { key: a.id, quantity: 2, revenueMinor: 250 },
        { key: b.id, quantity: 2, revenueMinor: 500 },
        { key: free.id, quantity: 2, revenueMinor: 0 },
      ],
    });
    expect(
      (
        await request(
          "GET",
          `/analytics/revenue?${windowQuery}&groupBy=category`,
        )
      ).body,
    ).toEqual({
      groupBy: "category",
      items: [
        { key: "books", quantity: 4, revenueMinor: 250 },
        { key: "home", quantity: 2, revenueMinor: 500 },
      ],
    });
    expect(
      (await request("GET", `/analytics/top-products?${windowQuery}&limit=2`))
        .body,
    ).toEqual({
      items: [
        { productId: b.id, quantity: 2, revenueMinor: 500 },
        { productId: a.id, quantity: 2, revenueMinor: 250 },
      ],
    });
  },
);
publicTest("ANA-id-tie-break", ["ANA-003"], async () => {
  const a = product("p-94000011"),
    b = product("p-94000012");
  await importProducts([b, a]);
  await request("POST", "/orders", {
    json: order(
      "o-ana-tie",
      [
        { productId: b.id, quantity: 1 },
        { productId: a.id, quantity: 1 },
      ],
      { orderedAt: "2025-01-01T00:00:00.000Z" },
    ),
    status: 201,
  });
  expect(
    (
      await request(
        "GET",
        "/analytics/top-products?from=2025-01-01T00:00:00.000Z&to=2025-01-02T00:00:00.000Z",
      )
    ).body,
  ).toEqual({
    items: [
      { productId: a.id, quantity: 1, revenueMinor: 125 },
      { productId: b.id, quantity: 1, revenueMinor: 125 },
    ],
  });
});
publicTest(
  "ANA-empty-window",
  ["ANA-001", "ANA-002", "ANA-003", "ORD-004"],
  async () => {
    await error(
      "POST",
      "/orders",
      {
        json: order(
          "o-ana-failed",
          [{ productId: "p-00000010", quantity: 1000000 }],
          { orderedAt: "2099-01-01T00:00:00.000Z" },
        ),
      },
      409,
      "INSUFFICIENT_STOCK",
    );
    await error("GET", "/orders/o-ana-failed", {}, 404, "ORDER_NOT_FOUND");
    for (const route of ["revenue?groupBy=product&", "top-products?"])
      expect(
        (
          await request(
            "GET",
            `/analytics/${route}from=2099-01-01T00:00:00.000Z&to=2099-02-01T00:00:00.000Z`,
          )
        ).body,
      ).toMatchObject({ items: [] });
  },
);
publicTest("ANA-validation", ["ANA-001", "ANA-002", "ANA-003"], async () => {
  for (const path of [
    "/analytics/revenue?groupBy=product",
    "/analytics/revenue?from=2024-01-02T00:00:00.000Z&to=2024-01-01T00:00:00.000Z&groupBy=product",
    `/analytics/revenue?${windowQuery}&groupBy=sku`,
    `/analytics/top-products?${windowQuery}&limit=0`,
    `/analytics/top-products?${windowQuery}&limit=1001`,
  ])
    await error("GET", path, {}, 400, "VALIDATION_ERROR");
  const costly = product("p-94000040", {
    priceMinor: 1000000000,
    inventory: 10000000,
  });
  await importProducts([costly]);
  for (let i = 0; i < 10; i++)
    await request("POST", "/orders", {
      json: order(
        `o-ana-overflow-${i}`,
        [{ productId: costly.id, quantity: 1000000 }],
        { orderedAt: "2027-01-01T00:00:00.000Z" },
      ),
      status: 201,
    });
  const overflowWindow =
    "from=2027-01-01T00:00:00.000Z&to=2027-01-02T00:00:00.000Z";
  for (const route of [
    `/analytics/revenue?${overflowWindow}&groupBy=product`,
    `/analytics/top-products?${overflowWindow}`,
  ])
    await error("GET", route, {}, 409, "NUMERIC_LIMIT");
});
publicTest(
  "ANA-empty-database",
  ["DATA-002", "ANA-002", "ANA-003"],
  async () => {
    expect(
      (
        await request(
          "GET",
          `/analytics/revenue?${windowQuery}&groupBy=category`,
          { empty: true },
        )
      ).body,
    ).toEqual({ groupBy: "category", items: [] });
    expect(
      (
        await request("GET", `/analytics/top-products?${windowQuery}`, {
          empty: true,
        })
      ).body,
    ).toEqual({ items: [] });
  },
  "empty",
);
