import { generate } from "../../src/fixtures";

for (const [name, counts] of Object.entries({
  public: { products: 12, customers: 4 },
  empty: { products: 0, customers: 0 },
}))
  console.log(
    name,
    await generate(`benchmark/fixtures/${name}`, 12345, counts),
  );
