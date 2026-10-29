import { expect } from "bun:test";
import { product, suite } from "./support";

const { publicTest, request, error, importProducts } = suite("import");
publicTest(
  "IMP-create-ordering-retry",
  ["IMP-002", "IMP-004", "CAT-003"],
  async () => {
    const a = product("p-96000001"),
      b = product("p-96000002", {
        priceMinor: 0,
        inventory: 0,
        status: "discontinued",
      });
    await importProducts([b, a]);
    expect((await request("GET", `/products/${b.id}`)).body).toEqual(b);
    await error(
      "POST",
      "/imports/products",
      {
        raw: `${JSON.stringify(b)}\n${JSON.stringify(a)}\n`,
        contentType: "application/x-ndjson",
      },
      409,
      "IMPORT_CONFLICT",
      1,
    );
    const response = await request<{ items: { id: string }[] }>(
      "GET",
      "/products?sort=id&direction=desc&limit=2",
    );
    expect(response.body.items.map((p) => p.id)).toEqual([b.id, a.id]);
  },
);
publicTest("IMP-late-rollback", ["IMP-002", "IMP-003"], async () => {
  const a = product("p-96000010");
  await error(
    "POST",
    "/imports/products",
    {
      raw: `${JSON.stringify(a)}\n{"id":"p-96000011"}\n`,
      contentType: "application/x-ndjson",
    },
    400,
    "VALIDATION_ERROR",
    2,
  );
  await error("GET", `/products/${a.id}`, {}, 404, "PRODUCT_NOT_FOUND");
  await importProducts([a]);
});
publicTest("IMP-duplicates", ["IMP-004"], async () => {
  for (const kind of ["id", "sku"] as const) {
    const a = product(kind === "id" ? "p-96000020" : "p-96000030");
    const b = product(kind === "id" ? a.id : "p-96000031", {
      sku: kind === "sku" ? a.sku : "DIFFERENT-SKU",
    });
    await error(
      "POST",
      "/imports/products",
      {
        raw: `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`,
        contentType: "application/x-ndjson",
      },
      409,
      "IMPORT_CONFLICT",
      2,
    );
    await error("GET", `/products/${a.id}`, {}, 404, "PRODUCT_NOT_FOUND");
  }
  await error(
    "POST",
    "/imports/products",
    {
      raw: JSON.stringify(product("p-96000032", { sku: "SKU-00000002" })),
      contentType: "application/x-ndjson",
    },
    409,
    "IMPORT_CONFLICT",
    1,
  );
});
publicTest(
  "IMP-wire-and-limits",
  ["GEN-003", "IMP-001", "IMP-002"],
  async () => {
    await error(
      "POST",
      "/imports/products",
      { raw: "{}\n", contentType: "application/json" },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    await error(
      "POST",
      "/imports/products",
      { raw: "\n", contentType: "application/x-ndjson" },
      400,
      "INVALID_JSON",
      1,
    );
    await error(
      "POST",
      "/imports/products",
      { raw: '{"id":', contentType: "application/x-ndjson" },
      400,
      "INVALID_JSON",
      1,
    );
    await error(
      "POST",
      "/imports/products",
      { raw: `${" ".repeat(4097)}\n`, contentType: "application/x-ndjson" },
      413,
      "INPUT_LIMIT",
      1,
    );
    const empty = await request("POST", "/imports/products", {
      raw: "",
      contentType: "application/x-ndjson",
    });
    expect(empty.body).toEqual({ imported: 0 });
    const record = JSON.stringify(product("p-96000050"));
    const padded =
      " ".repeat(4096 - new TextEncoder().encode(record).length) +
      record +
      "\n";
    expect(
      (
        await request("POST", "/imports/products", {
          raw: padded,
          contentType: "application/x-ndjson",
        })
      ).body,
    ).toEqual({ imported: 1 });
  },
);
publicTest("IMP-chunk-boundaries", ["IMP-001", "IMP-002"], async () => {
  const values = [
    product("p-96000040", { name: "café ☕" }),
    product("p-96000041"),
  ];
  const bytes = new TextEncoder().encode(
    values.map((p) => JSON.stringify(p)).join("\r\n"),
  );
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(index, index + 1));
      index++;
    },
  });
  expect(
    (
      await request("POST", "/imports/products", {
        raw: stream,
        contentType: "application/x-ndjson; charset=UTF-8",
      })
    ).body,
  ).toEqual({ imported: 2 });
  for (const p of values)
    expect((await request("GET", `/products/${p.id}`)).body).toEqual(p);
});
publicTest("IMP-over-one-MiB-stream", ["IMP-001", "IMP-003"], async () => {
  let index = 0,
    bytes = 0;
  const count = 6000;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === count) {
        controller.close();
        return;
      }
      let chunk = "";
      for (let j = 0; j < 64 && index < count; j++, index++)
        chunk += `${JSON.stringify(
          product(`p-${97000000 + index}`, { name: "A".repeat(200) }),
        )}\n`;
      const encoded = new TextEncoder().encode(chunk);
      bytes += encoded.length;
      controller.enqueue(encoded);
    },
  });
  expect(
    (
      await request("POST", "/imports/products", {
        raw: stream,
        contentType: "application/x-ndjson",
      })
    ).body,
  ).toEqual({ imported: count });
  expect(bytes).toBeGreaterThan(1048576);
  expect((await request("GET", "/products/p-97005999")).body).toEqual(
    product("p-97005999", { name: "A".repeat(200) }),
  );
});
