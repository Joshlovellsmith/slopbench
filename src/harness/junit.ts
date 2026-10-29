import type { Outcome } from "../schemas";

function decode(s: string) {
  return s.replace(
    /&(quot|apos|lt|gt|amp|#\d+|#x[\da-fA-F]+);/g,
    (_, entity: string) => {
      if (entity[0] === "#")
        return String.fromCodePoint(
          Number(entity[1] === "x" ? `0x${entity.slice(2)}` : entity.slice(1)),
        );
      return { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" }[entity]!;
    },
  );
}
// Parses Bun's controller-generated JUnit, never candidate-provided XML.
// Lazy attributes distinguish a self-closing pass from a later failure element.
export function readJUnit(xml: string, expectedCount: number): Outcome[] {
  const tests: Outcome[] = [];
  for (const m of xml.matchAll(
    /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const attrs = Object.fromEntries(
      [...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((v) => [
        v[1]!,
        decode(v[2]!),
      ]),
    );
    if (!attrs.name) throw new Error("Missing JUnit case name");
    if (/<skipped\b/.test(m[2] ?? ""))
      throw new Error(`Incomplete acceptance: skipped ${attrs.name}`);
    const durationMs = Number(attrs.time) * 1000;
    if (
      attrs.time === undefined ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    )
      throw new Error("Invalid JUnit case duration");
    tests.push(
      /<(failure|error)\b/.test(m[2] ?? "")
        ? {
            name: attrs.name,
            status: "failed",
            durationMs,
            message: decode(m[2]!).slice(0, 8000),
          }
        : { name: attrs.name, status: "passed", durationMs },
    );
  }
  if (
    tests.length !== expectedCount ||
    new Set(tests.map((t) => t.name)).size !== expectedCount
  )
    throw new Error(
      `Expected all ${expectedCount} unique public cases, got ${tests.length}`,
    );
  return tests;
}
