import { writeFile } from "node:fs/promises";
import {
  contractManifest,
  freezePath,
  verifyContract,
} from "../../src/contract";

if (process.argv.slice(2).join(" ") === "--freeze") {
  // One-time creation only. Never overwrites an existing freeze record.
  const manifest = await contractManifest();
  await writeFile(freezePath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(`Frozen ${manifest.files.length} files: ${manifest.sha256}`);
} else if (process.argv.length === 2) {
  const manifest = await verifyContract();
  console.log(
    `Frozen contract verified (${manifest.files.length} files): ${manifest.sha256}`,
  );
} else throw new Error("Usage: bun benchmark/scripts/freeze.ts [--freeze]");
