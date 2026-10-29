import { performance } from "node:perf_hooks";
import { type Outcome, productSchema } from "../schemas";
export async function smoke(
  base: string,
  expected: unknown,
  signal: AbortSignal,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const endpoint of ["health", "products"]) {
    const start = performance.now();
    let httpStatus: number | undefined;
    try {
      const response = await fetch(`${base}/${endpoint}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        redirect: "error",
      });
      httpStatus = response.status;
      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let text = "";
      let bytes = 0;
      if (reader)
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 1048576) throw new Error("Response exceeds 1 MiB");
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          await reader.cancel();
        }
      const data: unknown = JSON.parse(text);
      if (response.status !== 200)
        throw new Error(`Expected HTTP 200, got ${response.status}`);
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new Error("Expected application/json");
      if (endpoint === "health") {
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("Health must return a JSON object");
      } else {
        const obj = data as { products?: unknown[] };
        if (!Array.isArray(obj.products) || obj.products.length !== 1)
          throw new Error("Expected exactly one product");
        const actual = productSchema.parse(obj.products[0]);
        if (
          JSON.stringify(actual) !==
          JSON.stringify(productSchema.parse(expected))
        )
          throw new Error(
            `Fixture mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
          );
      }
      outcomes.push({
        status: "passed",
        name: endpoint,
        latencyMs: performance.now() - start,
        httpStatus,
      });
    } catch (error) {
      outcomes.push({
        status: "failed",
        name: endpoint,
        latencyMs: performance.now() - start,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        message: String(error),
      });
    }
  }
  return outcomes;
}
