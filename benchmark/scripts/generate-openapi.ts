// The committed .yaml is JSON syntax (a YAML subset); shared fixture fields are reused.
import { z } from "zod";
import { productSchema } from "../../src/schemas";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
type Schema = Record<string, unknown>;
const integer = (minimum = 0, maximum = 9007199254740991): Schema => ({
  type: "integer",
  minimum,
  maximum,
});
const text = (pattern?: string): Schema => ({
  type: "string",
  ...(pattern ? { pattern, not: { pattern: "[^A-Za-z0-9_-]" } } : {}),
});
const enumeration = (...values: string[]): Schema => ({
  type: "string",
  enum: values,
});
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const array = (items: Schema, minItems = 0, maxItems?: number): Schema => ({
  type: "array",
  items,
  minItems,
  ...(maxItems === undefined ? {} : { maxItems }),
});
const productId = text("^p-[0-9]{8}$"),
  customerId = text("^c-[0-9]{8}$"),
  orderId = text("^o-[A-Za-z0-9_-]{1,48}$");
const timestamp = {
  type: "string",
  format: "date-time",
  minLength: 24,
  maxLength: 24,
  pattern:
    "^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
  description:
    "Real Gregorian instant in [2000-01-01T00:00:00.000Z,2100-01-01T00:00:00.000Z).",
};
const category = enumeration("books", "home", "electronics", "clothing");
const fixture = z.toJSONSchema(productSchema);
delete fixture.$schema;
const product = {
  ...fixture,
  properties: {
    ...fixture.properties,
    id: productId,
    sku: text("^[A-Z0-9][A-Z0-9-]{0,63}$"),
    name: { type: "string", minLength: 1, maxLength: 200 },
    category,
    priceMinor: integer(0, 1e9),
    inventory: integer(0, 1e9),
    popularityWeight: integer(1, 1e6),
  },
};
const codes: Record<string, string[]> = {
  400: ["INVALID_JSON", "VALIDATION_ERROR"],
  404: [
    "NOT_FOUND",
    "PRODUCT_NOT_FOUND",
    "CUSTOMER_NOT_FOUND",
    "ORDER_NOT_FOUND",
  ],
  405: ["METHOD_NOT_ALLOWED"],
  409: [
    "INSUFFICIENT_STOCK",
    "INVENTORY_LIMIT",
    "PRODUCT_INACTIVE",
    "CUSTOMER_INACTIVE",
    "ORDER_EXISTS",
    "IMPORT_CONFLICT",
    "NUMERIC_LIMIT",
  ],
  413: ["INPUT_LIMIT"],
  415: ["UNSUPPORTED_MEDIA_TYPE"],
  500: ["INTERNAL_ERROR"],
  503: ["STORAGE_UNAVAILABLE"],
};
const schemas: Record<string, Schema> = {
  Product: product,
  Health: object({ status: { const: "ok", type: "string" } }),
  Inventory: object({ productId, quantity: integer(0, 1e9) }),
  Adjustment: object({ delta: integer(-1e9, 1e9) }),
  ProductPage: object({
    items: array(ref("Product"), 0, 1000),
    total: integer(),
    limit: integer(1, 1000),
    offset: integer(0, 1e9),
  }),
  OrderRequest: object({
    id: orderId,
    customerId,
    orderedAt: timestamp,
    items: {
      ...array(object({ productId, quantity: integer(1, 1e6) }), 1, 100),
      "x-unique-by": "productId",
    },
  }),
  Order: object({
    id: orderId,
    customerId,
    orderedAt: timestamp,
    status: enumeration("confirmed"),
    items: array(
      object({
        productId,
        category,
        quantity: integer(1, 1e6),
        unitPriceMinor: integer(0, 1e9),
        lineTotalMinor: integer(),
      }),
      1,
      100,
    ),
    totalMinor: integer(),
  }),
  Revenue: {
    oneOf: [
      object({
        groupBy: enumeration("product"),
        items: array(
          object({
            key: productId,
            quantity: integer(),
            revenueMinor: integer(),
          }),
        ),
      }),
      object({
        groupBy: enumeration("category"),
        items: array(
          object({
            key: category,
            quantity: integer(),
            revenueMinor: integer(),
          }),
        ),
      }),
    ],
  },
  TopProducts: object({
    items: array(
      object({ productId, quantity: integer(), revenueMinor: integer() }),
      0,
      1000,
    ),
  }),
  ImportResult: object({ imported: integer(0, 2e6) }),
  SimulationRequest: object({
    seed: integer(0, 4294967295),
    days: integer(1, 3650),
    scenarios: integer(1, 1e6),
    products: {
      ...array(
        object({
          productId,
          initialStock: integer(0, 1e9),
          demandMax: integer(0, 1000),
          reorderPoint: integer(0, 1e9),
          replenishmentQuantity: integer(0, 1e6),
          leadDays: integer(1, 30),
        }),
        1,
        1024,
      ),
      "x-unique-by": "productId",
    },
  }),
  SimulationResult: object({
    seed: integer(0, 4294967295),
    days: integer(1, 3650),
    scenarios: integer(1, 1e6),
    logicalProductDays: integer(1, 4e9),
    items: array(
      object({
        productId,
        demandedUnits: integer(),
        soldUnits: integer(),
        lostUnits: integer(),
        replenishedUnits: integer(),
        stockoutDays: integer(),
        endingStockUnitsSum: integer(),
        meanEndingStockMilli: integer(),
        fillRateBps: integer(0, 10000),
      }),
      1,
      1024,
    ),
  }),
};
for (const [status, values] of Object.entries(codes))
  schemas[`Error${status}`] = object({
    error: object({
      code: enumeration(...values),
      message: { type: "string", minLength: 1 },
      line: { type: ["integer", "null"], minimum: 1 },
    }),
  });
const json = (schema: Schema) => ({ "application/json": { schema } });
const query = (
  name: string,
  schema: Schema,
  required = false,
  description = "Canonical query syntax per GEN-003.",
) => ({ name, in: "query", required, description, schema });
const path = (name: string, schema: Schema) => ({
  name,
  in: "path",
  required: true,
  schema,
  description: "Exact ASCII identifier.",
});
const timeParams = [
  query("from", timestamp, true, "Inclusive UTC lower bound; ANA-001."),
  query(
    "to",
    timestamp,
    true,
    "Exclusive UTC upper bound; must exceed from; ANA-001.",
  ),
];
const paths: Record<string, unknown> = {};
function operation(
  route: string,
  method: string,
  id: string,
  requirements: string[],
  response: string,
  parameters: unknown[] = [],
  body?: string,
  status = 200,
) {
  const responses: Record<string, unknown> = {
    [String(status)]: {
      description:
        "Successful operation; all ordering/transaction semantics are normative in round-00.md.",
      content: json(ref(response)),
      ...(status === 201
        ? {
            headers: {
              Location: {
                description: "Relative order resource path.",
                schema: {
                  type: "string",
                  pattern: "^/orders/o-[A-Za-z0-9_-]{1,48}$",
                },
                required: true,
              },
            },
          }
        : {}),
    },
  };
  for (const code of [
    400,
    404,
    405,
    500,
    503,
    ...(method === "post" ? [413, 415] : []),
    ...(requirements.some((r) => /^(INV|ORD|ANA|IMP)-/.test(r)) ? [409] : []),
  ])
    responses[code] = {
      description: `${code}: see GEN-002 and endpoint semantics.`,
      content: json(ref(`Error${code}`)),
      ...(code === 405
        ? {
            headers: {
              Allow: {
                schema: { type: "string" },
                required: true,
                description: "Supported methods for this path.",
              },
            },
          }
        : {}),
    };
  const op = {
    operationId: id,
    summary: id.replace(/([A-Z])/g, " $1"),
    description: `Normative requirements: ${requirements.join(", ")}. See round-00.md; schema does not replace arithmetic, cross-field, stream or transaction requirements.`,
    tags: [requirements.find((r) => !r.startsWith("GEN"))!.split("-")[0]],
    "x-requirements": [
      "GEN-001",
      "GEN-002",
      "GEN-003",
      "GEN-004",
      "GEN-005",
      ...requirements,
    ],
    parameters,
    responses,
    ...(body
      ? {
          requestBody: {
            required: body !== "NDJSON",
            content:
              body === "NDJSON"
                ? {
                    "application/x-ndjson": {
                      schema: {
                        type: "string",
                        description:
                          "UTF-8 Product records separated by LF; CRLF and final missing LF supported. See IMP-001.",
                        "x-record-schema": ref("Product"),
                        "x-max-bytes": 2147483648,
                        "x-max-records": 2000000,
                        "x-max-line-bytes": 4096,
                      },
                    },
                  }
                : json(ref(body)),
          },
        }
      : {}),
  };
  paths[route] = { ...((paths[route] as object) ?? {}), [method]: op };
}
operation("/health", "get", "health", ["DATA-002"], "Health");
operation(
  "/products",
  "get",
  "listProducts",
  ["CAT-001", "CAT-002", "CAT-003"],
  "ProductPage",
  [
    query("limit", { ...integer(1, 1000), default: 20 }),
    query("offset", { ...integer(0, 1e9), default: 0 }),
    query("category", category),
    query("minPrice", integer(0, 1e9)),
    query("maxPrice", integer(0, 1e9)),
    query("active", { type: "boolean" }),
    query("sort", {
      ...enumeration("id", "sku", "priceMinor", "inventory"),
      default: "id",
    }),
    query("direction", { ...enumeration("asc", "desc"), default: "asc" }),
  ],
);
operation(
  "/products/{productId}",
  "get",
  "getProduct",
  ["CAT-004", "DATA-001"],
  "Product",
  [path("productId", productId)],
);
operation(
  "/inventory/{productId}",
  "get",
  "getInventory",
  ["INV-001"],
  "Inventory",
  [path("productId", productId)],
);
operation(
  "/inventory/{productId}/adjustments",
  "post",
  "adjustInventory",
  ["INV-002", "INV-003"],
  "Inventory",
  [path("productId", productId)],
  "Adjustment",
);
operation(
  "/orders",
  "post",
  "createOrder",
  ["ORD-001", "ORD-002", "ORD-003", "ORD-004", "ORD-005"],
  "Order",
  [],
  "OrderRequest",
  201,
);
operation("/orders/{orderId}", "get", "getOrder", ["ORD-005"], "Order", [
  path("orderId", orderId),
]);
operation(
  "/analytics/revenue",
  "get",
  "revenue",
  ["ANA-001", "ANA-002"],
  "Revenue",
  [...timeParams, query("groupBy", enumeration("product", "category"), true)],
);
operation(
  "/analytics/top-products",
  "get",
  "topProducts",
  ["ANA-001", "ANA-003"],
  "TopProducts",
  [...timeParams, query("limit", { ...integer(1, 1000), default: 10 })],
);
operation(
  "/imports/products",
  "post",
  "importProducts",
  ["IMP-001", "IMP-002", "IMP-003", "IMP-004"],
  "ImportResult",
  [],
  "NDJSON",
);
operation(
  "/analytics/demand-simulation",
  "post",
  "demandSimulation",
  ["SIM-001", "SIM-002", "SIM-003", "SIM-004", "SIM-005", "SIM-006"],
  "SimulationResult",
  [],
  "SimulationRequest",
);
const document = {
  openapi: "3.1.1",
  "x-number-decoding":
    "Validate schemas after the GEN-001 correctly rounded binary64 wire-number interpretation; subsequent arithmetic has exact integer semantics.",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "SlopShop Round 0",
    version: "0.1.0",
    description:
      "Public benchmark contract. round-00.md defines all cross-field rules, error priority and exact numerical semantics.",
  },
  servers: [
    {
      url: "http://localhost:8080",
      description:
        "Local candidate; actual isolated address is supplied by its controller.",
    },
  ],
  security: [],
  tags: ["DATA", "CAT", "INV", "ORD", "ANA", "IMP", "SIM"].map((name) => ({
    name,
    description: `${name} requirements in round-00.md`,
  })),
  paths,
  components: { schemas },
};
if (process.argv.includes("--check")) {
  if (
    JSON.stringify(await Bun.file("benchmark/spec/openapi.yaml").json()) !==
    JSON.stringify(document)
  )
    throw new Error("Stale OpenAPI; run round0:generate-openapi");
} else
  await Bun.write(
    "benchmark/spec/openapi.yaml",
    `${JSON.stringify(document, null, 2)}\n`,
  );
