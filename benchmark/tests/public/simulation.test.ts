import { expect } from "bun:test";
import {
  randomWord,
  type SimulationInput,
  simulateSmall,
} from "../../oracle/simulation";
import { suite, validateSchema, vectors } from "./support";

const { publicTest, request, error } = suite("simulation");
publicTest(
  "SIM-oracle-vectors",
  ["SIM-002", "SIM-003", "SIM-004", "SIM-006"],
  () => {
    for (const v of vectors.randomWords)
      expect(randomWord(v.seed, v.productOrdinal, v.scenario, v.day)).toBe(
        v.word,
      );
    for (const v of vectors.cases) {
      validateSchema("SimulationRequest", v.input);
      validateSchema("SimulationResult", v.expected);
      expect(simulateSmall(v.input), v.name).toEqual(v.expected);
    }
  },
  "oracle",
);
publicTest(
  "SIM-http-golden",
  ["SIM-001", "SIM-002", "SIM-003", "SIM-004", "SIM-006"],
  async () => {
    for (const vector of vectors.cases)
      expect(
        (
          await request("POST", "/analytics/demand-simulation", {
            json: vector.input,
          })
        ).body,
        vector.name,
      ).toEqual(vector.expected);
  },
);
publicTest("SIM-permutation-and-purity", ["SIM-005", "SIM-004"], async () => {
  const v = vectors.cases.find(
    (v: { name: string }) => v.name === "two-products",
  )!;
  const before = (await request("GET", "/products")).body;
  const input = { ...v.input, products: [...v.input.products].reverse() };
  const results = await Promise.all([
    request("POST", "/analytics/demand-simulation", { json: input }),
    request("POST", "/analytics/demand-simulation", { json: v.input }),
  ]);
  for (const r of results) expect(r.body).toEqual(v.expected);
  expect((await request("GET", "/products")).body).toEqual(before);
});
publicTest("SIM-validation-and-references", ["SIM-001"], async () => {
  const base = vectors.cases.find((v) => v.name === "zero-demand")!
    .input as SimulationInput;
  for (const change of [
    { seed: -1 },
    { seed: 4294967296 },
    { seed: "1" },
    { days: 0 },
    { days: 3651 },
    { scenarios: 0 },
    { scenarios: 1000001 },
    { products: [] },
    { products: [base.products[0]!, base.products[0]!] },
    { products: [{ ...base.products[0]!, leadDays: 0 }] },
    { products: [{ ...base.products[0]!, demandMax: 1001 }] },
    { products: [{ ...base.products[0]!, initialStock: null }] },
    {
      scenarios: 1000000,
      days: 3650,
      products: [
        base.products[0]!,
        { ...base.products[0]!, productId: "p-00000003" },
      ],
    },
  ])
    await error(
      "POST",
      "/analytics/demand-simulation",
      { json: { ...base, ...change } },
      400,
      "VALIDATION_ERROR",
    );
  await error(
    "POST",
    "/analytics/demand-simulation",
    {
      json: {
        ...base,
        products: [{ ...base.products[0]!, productId: "p-88888888" }],
      },
    },
    404,
    "PRODUCT_NOT_FOUND",
  );
});
publicTest(
  "SIM-empty-reference",
  ["DATA-002", "SIM-001"],
  async () => {
    await error(
      "POST",
      "/analytics/demand-simulation",
      {
        json: vectors.cases.find((v) => v.name === "zero-demand")!.input,
        empty: true,
      },
      404,
      "PRODUCT_NOT_FOUND",
    );
  },
  "empty",
);
publicTest("SIM-inactive-is-valid", ["SIM-001", "SIM-005"], async () => {
  const input = {
    ...vectors.cases.find((v) => v.name === "zero-demand")!.input,
    products: [
      {
        ...vectors.cases.find((v) => v.name === "zero-demand")!.input
          .products[0]!,
        productId: "p-00000001",
      },
    ],
  };
  expect(
    (await request("POST", "/analytics/demand-simulation", { json: input }))
      .body,
  ).toEqual(simulateSmall(input));
});
