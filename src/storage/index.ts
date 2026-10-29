import { Database } from "bun:sqlite";
import { mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Result, resultSchema } from "../schemas";
export async function saveResult(root: string, value: Result) {
  const result = resultSchema.parse(value);
  await mkdir(root, { recursive: true });
  const dir = join(root, result.runId);
  await mkdir(dir, { recursive: true });
  const artifact = resolve(dir, "result.json");
  await Bun.write(`${artifact}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  await rename(`${artifact}.tmp`, artifact);
  const db = index(root);
  try {
    db.query("INSERT INTO runs VALUES (?, ?, ?, ?, ?)").run(
      result.runId,
      result.startedAt,
      result.experiment.candidate.id,
      result.status.state,
      artifact,
    );
  } finally {
    db.close();
  }
  return artifact;
}
function index(root: string) {
  const db = new Database(join(root, "index.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, candidate TEXT NOT NULL, status TEXT NOT NULL, artifact TEXT NOT NULL)",
  );
  return db;
}
export async function latest(root: string) {
  await mkdir(root, { recursive: true });
  const db = index(root);
  try {
    const row = db
      .query(
        "SELECT artifact FROM runs ORDER BY started_at DESC, id DESC LIMIT 1",
      )
      .get() as { artifact: string } | null;
    if (!row) throw new Error("No runs recorded");
    return resultSchema.parse(await Bun.file(row.artifact).json());
  } finally {
    db.close();
  }
}
