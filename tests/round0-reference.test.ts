import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { simulateSmall } from "../benchmark/oracle/simulation";
import {
  simulate,
  simulationInput,
} from "../examples/round0-reference/simulation";
import {
  ApiError,
  body,
  integer,
  json,
  lines,
  product,
  query,
  timestamp,
} from "../examples/round0-reference/wire";
import { readJUnit } from "../src/harness/junit";
import { outcomeSchema } from "../src/schemas";

const bytes = (s: string) => new TextEncoder().encode(s);
test("early input rejection releases readers without destroying the HTTP input", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes("{}\n"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const iterator = lines(stream);
  expect((await iterator.next()).value).toMatchObject({ line: 1 });
  await iterator.return(undefined);
  expect(cancelled).toBe(false);
  expect(stream.locked).toBe(false);
  await stream.cancel();
  cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes("    "));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://candidate/", {
    method: "POST",
    body: oversized,
  });
  await expect(body(request, 3)).rejects.toMatchObject({
    status: 413,
    code: "INPUT_LIMIT",
  });
  expect(cancelled).toBe(false);
  expect(oversized.locked).toBe(false);
  await oversized.cancel();
});
test("reference wire parser enforces decoded keys, scalars, UTF-8 and binary64 semantics", () => {
  for (const raw of [
    '{"delta":1,"d\\u0065lta":2}',
    '{"x":{"y":1,"y":2}}',
    '"\\ud800"',
    '{"\\udc00":0}',
    "\ufeff{}",
    '{"x":NaN}',
  ]) {
    try {
      json(bytes(raw));
      throw new Error(`Accepted ${raw}`);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("INVALID_JSON");
    }
  }
  expect(() => json(new Uint8Array([0x22, 0xff, 0x22]))).toThrow();
  expect(json(bytes('{"x":1.0,"y":1e0,"z":1.00000000000000001}'))).toEqual({
    x: 1,
    y: 1,
    z: 1,
  });
  expect(integer(json(bytes("-0")), 0, 1)).toBe(0);
  expect(() => json(bytes('{"unknown":[1e309]}'))).toThrow("VALIDATION_ERROR");
  expect(json(bytes('{"a":[{"b":1},{"b":2}],"b":"😀"}'))).toEqual({
    a: [{ b: 1 }, { b: 2 }],
    b: "😀",
  });
  // Deep and wide input cannot overflow an application-level recursion/spread stack.
  expect(Array.isArray(json(bytes(`[${"0,".repeat(100000)}0]`)))).toBe(true);
  expect(() =>
    json(bytes(`${"[".repeat(20000)}0${"]".repeat(20000)}`)),
  ).not.toThrow();
});
test("reference validation preserves scalar names and rejects noncanonical query/date values", () => {
  const base = {
    id: "p-12345678",
    sku: "SKU-X",
    name: "😀".repeat(200),
    category: "books",
    priceMinor: 0,
    inventory: 0,
    status: "active",
    popularityWeight: 1,
  };
  expect(product(base).name).toBe(base.name);
  expect(() => product({ ...base, name: `${base.name}x` })).toThrow();
  for (const search of [
    "?limit=%ff",
    "?limit=1&l%69mit=2",
    "?unknown=1",
    "?limit=",
  ])
    expect(() => query(search, ["limit"])).toThrow();
  expect(query("?x=a+b", ["x"]).x).toBe("a b");
  expect(timestamp("2024-02-29T00:00:00.000Z")).toBe(
    "2024-02-29T00:00:00.000Z",
  );
  for (const date of [
    "2023-02-29T00:00:00.000Z",
    "2024-01-01T24:00:00.000Z",
    "2024-01-01T00:00:60.000Z",
  ])
    expect(() => timestamp(date)).toThrow();
});
test("reference line framing bounds physical bytes and handles split multibyte CRLF", async () => {
  async function* stream() {
    for (const b of bytes('"café"\r\n{}')) yield Uint8Array.of(b);
  }
  const result = [];
  for await (const line of lines(stream(), 4096))
    result.push({ value: json(line.bytes), line: line.line });
  expect(result).toEqual([
    { value: "café", line: 1 },
    { value: {}, line: 2 },
  ]);
  async function* tooLong() {
    yield bytes("    \n");
  }
  expect(async () => {
    for await (const _ of lines(tooLong(), 3)) {
    }
  }).toThrow();
});
test("reference numerical kernel agrees with the independent small oracle and has no oracle cap", () => {
  const vectors = JSON.parse(
    readFileSync("benchmark/fixtures/simulation-vectors.json", "utf8"),
  );
  for (const vector of vectors.cases)
    expect(simulate(simulationInput(vector.input))).toEqual(vector.expected);
  const base = vectors.cases.find(
    (v: { name: string }) => v.name === "two-products",
  ).input;
  for (let seed = 0; seed < 40; seed++) {
    const input = simulationInput({ ...base, seed, days: 7, scenarios: 11 });
    expect(simulate(input)).toEqual(simulateSmall(input));
  }
  const input = simulationInput({
    seed: 4294967295,
    days: 1,
    scenarios: 100001,
    products: [
      {
        productId: "p-00000002",
        initialStock: 1000000000,
        demandMax: 0,
        reorderPoint: 0,
        replenishmentQuantity: 0,
        leadDays: 1,
      },
    ],
  });
  expect(simulate(input).items[0]).toMatchObject({
    endingStockUnitsSum: 100001000000000,
    meanEndingStockMilli: 1000000000000,
    fillRateBps: 10000,
  });
});
test("JUnit ingestion retains failures between self-closing passes and rejects skips/incomplete cases", () => {
  const xml =
    '<testcase name="a" time="0.1" /><testcase name="b" time="0.2"><failure message="bad &amp; wrong">expected&#10;got</failure></testcase><testcase name="c" time="0" />';
  const result = readJUnit(xml, 3);
  expect(result.map((t) => t.status)).toEqual(["passed", "failed", "passed"]);
  expect(result[0]).toEqual({ name: "a", status: "passed", durationMs: 100 });
  expect(result[1]).toMatchObject({
    message: '<failure message="bad & wrong">expected\ngot</failure>',
  });
  for (const r of result) expect(outcomeSchema.safeParse(r).success).toBe(true);
  expect(() => readJUnit(xml, 4)).toThrow();
  expect(() =>
    readJUnit('<testcase name="skip" time="0"><skipped /></testcase>', 1),
  ).toThrow("skipped");
  expect(() =>
    readJUnit('<testcase name="a" time="0"/><testcase name="a" time="0"/>', 2),
  ).toThrow();
  expect(() => readJUnit('<testcase name="missing-time"/>', 1)).toThrow();
});
