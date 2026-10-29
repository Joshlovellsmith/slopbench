// Small-input executable mathematical oracle, never a candidate HTTP implementation.
export interface SimulationProduct {
  productId: string;
  initialStock: number;
  demandMax: number;
  reorderPoint: number;
  replenishmentQuantity: number;
  leadDays: number;
}
export interface SimulationInput {
  seed: number;
  days: number;
  scenarios: number;
  products: SimulationProduct[];
}
export function randomWord(
  seed: number,
  p: number,
  s: number,
  d: number,
): number {
  let x =
    seed ^
    Math.imul(p + 1, 0x9e3779b9) ^
    Math.imul(s + 1, 0x85ebca6b) ^
    Math.imul(d + 1, 0xc2b2ae35);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
function halfUp(n: bigint, d: bigint) {
  return Number((2n * n + d) / (2n * d));
}
export function simulateSmall(input: SimulationInput) {
  const { seed, days, scenarios } = input;
  const logicalProductDays = input.products.length * days * scenarios;
  if (logicalProductDays > 100000)
    throw new Error(
      "Public numerical oracle is restricted to 100000 logical operations",
    );
  const items = [...input.products]
    .sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    )
    .map((product, p) => {
      let demandedUnits = 0,
        soldUnits = 0,
        lostUnits = 0,
        replenishedUnits = 0,
        stockoutDays = 0,
        endingStockUnitsSum = 0;
      for (let s = 0; s < scenarios; s++) {
        let stock = product.initialStock;
        let arrival: number | undefined;
        for (let d = 0; d < days; d++) {
          if (arrival === d) {
            stock += product.replenishmentQuantity;
            replenishedUnits += product.replenishmentQuantity;
            arrival = undefined;
          }
          if (
            stock <= product.reorderPoint &&
            product.replenishmentQuantity > 0 &&
            arrival === undefined
          )
            arrival = d + product.leadDays;
          const demand = randomWord(seed, p, s, d) % (product.demandMax + 1);
          const sold = Math.min(stock, demand);
          const lost = demand - sold;
          stock -= sold;
          demandedUnits += demand;
          soldUnits += sold;
          lostUnits += lost;
          if (lost > 0) stockoutDays++;
        }
        endingStockUnitsSum += stock;
      }
      return {
        productId: product.productId,
        demandedUnits,
        soldUnits,
        lostUnits,
        replenishedUnits,
        stockoutDays,
        endingStockUnitsSum,
        meanEndingStockMilli: halfUp(
          1000n * BigInt(endingStockUnitsSum),
          BigInt(scenarios),
        ),
        fillRateBps:
          demandedUnits === 0
            ? 10000
            : halfUp(10000n * BigInt(soldUnits), BigInt(demandedUnits)),
      };
    });
  return { seed, days, scenarios, logicalProductDays, items };
}
