import { expect } from "bun:test";
import { type Page, products, suite } from "./support";

const { publicTest, request, error } = suite("catalogue");
publicTest("CAT-defaults", ["CAT-001", "CAT-003"], async () => {
  expect((await request("GET", "/products")).body).toEqual({
    items: products,
    total: 12,
    limit: 20,
    offset: 0,
  });
});
publicTest("CAT-filters", ["CAT-002"], async () => {
  const r = await request<Page>(
    "GET",
    "/products?category=clothing&minPrice=1000&maxPrice=10000&active=true",
  );
  expect(r.body.items.map((p) => p.id)).toEqual([
    "p-00000003",
    "p-00000008",
    "p-00000010",
    "p-00000012",
  ]);
  expect(r.body.total).toBe(4);
  const zero = await request<Page>(
    "GET",
    "/products?active=false&minPrice=0&maxPrice=0",
  );
  expect(zero.body.items).toEqual([products[0]!]);
});
publicTest("CAT-pagination-and-empty", ["CAT-001"], async () => {
  const a = await request<Page>("GET", "/products?limit=2&offset=2");
  expect(a.body).toEqual({
    items: products.slice(2, 4),
    total: 12,
    limit: 2,
    offset: 2,
  });
  const b = await request<Page>(
    "GET",
    "/products?limit=1000&offset=1000000000",
  );
  expect(b.body).toEqual({
    items: [],
    total: 12,
    limit: 1000,
    offset: 1000000000,
  });
  expect(
    (await request<Page>("GET", "/products?category=books")).body.items,
  ).toEqual([]);
});
publicTest("CAT-sort-and-ties", ["CAT-003"], async () => {
  for (const sort of ["id", "sku", "priceMinor", "inventory"] as const)
    for (const direction of ["asc", "desc"]) {
      const expected = [...products].sort((a, b) => {
        const x = a[sort],
          y = b[sort];
        const primary = x < y ? -1 : x > y ? 1 : 0;
        return (
          primary * (direction === "asc" ? 1 : -1) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        );
      });
      expect(
        (
          await request<Page>(
            "GET",
            `/products?sort=${sort}&direction=${direction}`,
          )
        ).body.items,
      ).toEqual(expected);
    }
});
publicTest(
  "CAT-invalid-queries",
  ["GEN-003", "CAT-001", "CAT-002", "CAT-003"],
  async () => {
    for (const query of [
      "limit=0",
      "limit=1001",
      "limit=01",
      "limit=1.0",
      "limit=1e2",
      "limit=1%0A",
      "limit=%ZZ",
      "offset=-1",
      "active=1",
      "active=TRUE",
      "category=Books",
      "minPrice=5&maxPrice=4",
      "sort=name",
      "direction=DESC",
      "limit=1&limit=2",
      "unknown=1",
      "limit=",
      "minPrice=null",
      "minPrice=1000000001",
    ]) {
      await error("GET", `/products?${query}`, {}, 400, "VALIDATION_ERROR");
    }
  },
);
publicTest("CAT-get-and-errors", ["CAT-004", "GEN-005"], async () => {
  expect((await request("GET", "/products/p-00000001")).body).toEqual(
    products[0],
  );
  await error("GET", "/products/p-88888888", {}, 404, "PRODUCT_NOT_FOUND");
  await error("GET", "/products/bad", {}, 400, "VALIDATION_ERROR");
  await error("GET", "/unknown", {}, 404, "NOT_FOUND");
  const response = await error(
    "POST",
    "/products",
    { json: {} },
    405,
    "METHOD_NOT_ALLOWED",
  );
  expect(response.headers.get("allow")).toContain("GET");
});
publicTest(
  "CAT-empty-initialization",
  ["DATA-001", "DATA-002", "CAT-001"],
  async () => {
    expect((await request("GET", "/products", { empty: true })).body).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    await error(
      "GET",
      "/products/p-00000001",
      { empty: true },
      404,
      "PRODUCT_NOT_FOUND",
    );
  },
  "empty",
);
