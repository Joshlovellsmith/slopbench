import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";

const write = process.argv.includes("--write");
const spec = await readFile("benchmark/spec/round-00.md", "utf8");
const requirements = new Map(
  [...spec.matchAll(/^### ([A-Z]+-\d{3}) — (.+)$/gm)].map((m) => [
    m[1]!,
    m[2]!,
  ]),
);
const strategies = JSON.parse(
  await readFile("benchmark/spec/verification-strategies.json", "utf8"),
) as Record<string, { privatePlan: string; workloads: string[] }>;
const tests: {
  id: string;
  requirements: string[];
  file: string;
  needs: string;
}[] = [];
for (const file of (await readdir("benchmark/tests/public"))
  .filter((f) => f.endsWith(".test.ts"))
  .sort()) {
  const source = ts.createSourceFile(
    file,
    await readFile(`benchmark/tests/public/${file}`, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "publicTest"
    ) {
      const [name, ids, , needs] = node.arguments;
      if (
        !name ||
        !ts.isStringLiteral(name) ||
        !ids ||
        !ts.isArrayLiteralExpression(ids) ||
        ids.elements.length === 0
      )
        throw new Error(`Non-literal/unmapped public test in ${file}`);
      const references = ids.elements.map((id) => {
        if (!ts.isStringLiteral(id) || !requirements.has(id.text))
          throw new Error(
            `Unknown requirement in ${file}: ${id.getText(source)}`,
          );
        return id.text;
      });
      if (tests.some((t) => t.id === name.text))
        throw new Error(`Duplicate test ID ${name.text}`);
      tests.push({
        id: name.text,
        requirements: references,
        file,
        needs: needs && ts.isStringLiteral(needs) ? needs.text : "candidate",
      });
    }
    if (
      ts.isCallExpression(node) &&
      /^(test|it)(\.|$)/.test(node.expression.getText(source))
    )
      throw new Error(`Public tests must register through publicTest: ${file}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const [id, title] of requirements) {
  const strategy = strategies[id];
  if (!strategy?.privatePlan || !strategy.workloads.length)
    throw new Error(`Missing strategy for ${id}`);
  if (!tests.some((t) => t.requirements.includes(id)))
    throw new Error(`No public coverage for ${id}: ${title}`);
  for (const workload of strategy.workloads)
    if (
      !(
        await readFile("benchmark/workloads/saturation-round-00.md", "utf8")
      ).includes(workload)
    )
      throw new Error(`Unknown workload ${workload}`);
}
for (const id of Object.keys(strategies))
  if (!requirements.has(id)) throw new Error(`Unpublished strategy ${id}`);
const api = JSON.parse(await readFile("benchmark/spec/openapi.yaml", "utf8"));
let operations = 0;
for (const [path, item] of Object.entries(api.paths) as [
  string,
  Record<string, { "x-requirements": string[] }>,
][]) {
  for (const [method, op] of Object.entries(item)) {
    if (!["get", "post"].includes(method))
      throw new Error(`Unexpected operation ${method} ${path}`);
    operations++;
    for (const id of op["x-requirements"] ?? [])
      if (!requirements.has(id))
        throw new Error(`Unpublished OpenAPI requirement ${id}`);
    if (!spec.includes(`\`${method.toUpperCase()} ${path}`))
      throw new Error(`Operation absent from prose ${method} ${path}`);
  }
}
const index =
  "# Round 0 requirement index\n\nNormative definitions are in [round-00.md](round-00.md). This generated index does\nnot replace them. Regenerate with `bun benchmark/scripts/check-contract.ts --write`.\n\n| Requirement | Definition |\n| --- | --- |\n" +
  [...requirements]
    .map(
      ([id, title]) =>
        `| ${id} | [${title}](round-00.md#${id.toLowerCase()}--${title
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "")
          .replace(/ +/g, "-")}) |`,
    )
    .join("\n") +
  "\n";
const matrix =
  "# Round 0 traceability\n\nGenerated from normative requirement headings, literal public-test registrations,\nand `verification-strategies.json`. Private entries are proposals only; no hidden\ntest implementation exists here. Tests marked `empty` or `control` require those\nexternal resources. The `oracle` test validates numerical artifacts, not a candidate.\nA test registration is coverage intent, not evidence that a candidate passes.\n\n| Requirement | Public tests | Proposed separate private verification | Workloads |\n| --- | --- | --- | --- |\n" +
  [...requirements]
    .map(
      ([id]) =>
        `| [${id}](../benchmark/spec/requirements.md) | ${tests
          .filter((t) => t.requirements.includes(id))
          .map(
            (t) =>
              `[${t.id}${t.needs !== "candidate" ? ` (${t.needs})` : ""}](../benchmark/tests/public/${t.file})`,
          )
          .join(
            ", ",
          )} | ${strategies[id]!.privatePlan} | ${strategies[id]!.workloads.join(", ")} |`,
    )
    .join("\n") +
  "\n";
for (const [path, content] of [
  ["benchmark/spec/requirements.md", index],
  ["docs/round-00-traceability.md", matrix],
]) {
  if (write) await Bun.write(path!, content!);
  else if ((await readFile(path!, "utf8")) !== content)
    throw new Error(`Stale generated ${path}; run with --write`);
}
console.log(
  JSON.stringify({
    requirements: requirements.size,
    publicTests: tests.length,
    operations,
    oracleTests: tests.filter((t) => t.needs === "oracle").length,
    conditionalTests: tests.filter((t) =>
      ["empty", "control"].includes(t.needs),
    ).length,
  }),
);
