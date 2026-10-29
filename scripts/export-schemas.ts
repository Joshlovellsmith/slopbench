import { z } from "zod";
import {
  candidateSchema,
  customerSchema,
  fixtureManifestSchema,
  productSchema,
  resultSchema,
} from "../src/schemas";

for (const [name, schema] of Object.entries({
  candidate: candidateSchema,
  product: productSchema,
  customer: customerSchema,
  "fixture-manifest": fixtureManifestSchema,
  result: resultSchema,
})) {
  await Bun.write(
    `spec/schemas/${name}-v1.json`,
    `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`,
  );
}
