import { Database } from "bun:sqlite";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const databasePath = process.env.DATABASE_PATH;
const fixtureDir = process.env.FIXTURE_DIR;
if (!databasePath || !fixtureDir)
  throw new Error("DATABASE_PATH and FIXTURE_DIR are required");
const db = new Database(databasePath);
db.exec("CREATE TABLE products (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
const insert = db.prepare("INSERT INTO products VALUES (?, ?)");
db.exec("BEGIN");
for await (const line of createInterface({
  input: createReadStream(`${fixtureDir}/products.jsonl`),
  crlfDelay: Infinity,
})) {
  const product = JSON.parse(line);
  insert.run(product.id, line);
}
db.exec("COMMIT");
Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  hostname: "0.0.0.0",
  fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (url.pathname === "/products") {
      const row = db
        .query("SELECT body FROM products ORDER BY id LIMIT 1")
        .get() as { body: string } | null;
      const product = row ? JSON.parse(row.body) : undefined;
      if (product && process.env.FAULTY === "1") product.priceMinor++;
      return Response.json({ products: product ? [product] : [] });
    }
    return new Response("Not found", { status: 404 });
  },
});
