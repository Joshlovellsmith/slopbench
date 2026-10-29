"""Independent arbitrary-integer oracle; no server, SQLite or candidate code.
Default checks committed vectors; --write explicitly replaces the golden artifact.
"""
import json
import pathlib
import sys

MASK = 2**32 - 1
ROOT = pathlib.Path(__file__).resolve().parents[1]


def word(seed, product, scenario, day):
    address = seed
    for index, multiplier in zip((product, scenario, day), (2654435769, 2246822507, 3266489909)):
        address ^= ((index + 1) * multiplier) % (2**32)
    for shift, multiplier in ((16, 2246822507), (13, 3266489909)):
        address = ((address ^ (address >> shift)) * multiplier) & MASK
    return address ^ (address >> 16)


def simulation(data):
    rows = []
    for ordinal, product in enumerate(sorted(data["products"], key=lambda p: p["productId"])):
        counters = dict(demandedUnits=0, soldUnits=0, lostUnits=0, replenishedUnits=0,
                        stockoutDays=0, endingStockUnitsSum=0)
        for scenario in range(data["scenarios"]):
            on_hand = product["initialStock"]
            # Explicit event calendar differs from the scalar pending-day TS oracle.
            events = {}
            for day in range(data["days"]):
                receipt = events.pop(day, 0)
                on_hand += receipt
                counters["replenishedUnits"] += receipt
                if not events and on_hand <= product["reorderPoint"] and product["replenishmentQuantity"]:
                    events[day + product["leadDays"]] = product["replenishmentQuantity"]
                wanted = word(data["seed"], ordinal, scenario, day) % (product["demandMax"] + 1)
                fulfilled = min(wanted, on_hand)
                on_hand -= fulfilled
                for key, increment in (("demandedUnits", wanted), ("soldUnits", fulfilled),
                                       ("lostUnits", wanted - fulfilled), ("stockoutDays", int(wanted > fulfilled))):
                    counters[key] += increment
            counters["endingStockUnitsSum"] += on_hand
        counters["meanEndingStockMilli"] = (2000 * counters["endingStockUnitsSum"] + data["scenarios"]) // (2 * data["scenarios"])
        counters["fillRateBps"] = ((20000 * counters["soldUnits"] + counters["demandedUnits"]) // (2 * counters["demandedUnits"])) if counters["demandedUnits"] else 10000
        rows.append(dict(productId=product["productId"], **counters))
    return dict(seed=data["seed"], days=data["days"], scenarios=data["scenarios"],
                logicalProductDays=len(rows)*data["days"]*data["scenarios"], items=rows)


def product(identifier="p-00000002", **changes):
    return {**dict(productId=identifier, initialStock=0, demandMax=1, reorderPoint=0,
                   replenishmentQuantity=1, leadDays=1), **changes}



def generate():
    inputs = [
        ("profile-small", dict(seed=12345, days=4, scenarios=3, products=[product(identifier, initialStock=40, demandMax=17, reorderPoint=12, replenishmentQuantity=50, leadDays=3) for identifier in ("p-00000002", "p-00000003")])),
        ("zero-demand", dict(seed=0, days=2, scenarios=2, products=[product(initialStock=3, demandMax=0, replenishmentQuantity=0)])),
        ("day-one-arrival", dict(seed=next(s for s in range(100) if word(s, 0, 0, 0)%2 == 1 and word(s, 0, 0, 1)%2 == 1), days=2, scenarios=1, products=[product()])),
        ("two-products", dict(seed=12345, days=4, scenarios=3, products=[product("p-00000003", initialStock=2, demandMax=2, reorderPoint=1, replenishmentQuantity=2, leadDays=2), product(demandMax=3, replenishmentQuantity=3)])),
        ("unsigned-boundaries", dict(seed=4294967295, days=5, scenarios=7, products=[product(initialStock=1, demandMax=17, replenishmentQuantity=5, leadDays=3)])),
        ("safe-rounding", dict(seed=7, days=1, scenarios=100000, products=[product(initialStock=999999999, demandMax=0, replenishmentQuantity=0)])),
        ("half-up-tie", dict(seed=next(s for s in range(100) if sum(1 - word(s,0,t,0)%2 for t in range(16))%2), days=1, scenarios=16, products=[product(initialStock=1, demandMax=1, replenishmentQuantity=0)])),
    ]
    coordinates = [(0,0,0,0),(1,0,0,0),(2,0,0,0),(2,0,0,1),(12345,0,0,0),(4294967295,0,0,0),
                   (12345,1,0,0),(12345,0,1,0),(12345,0,0,1),(4294967295,1023,999999,3649)]
    return dict(schemaVersion="1", contractVersion="0.1.0", algorithm="slop-counter32-v1",
                randomWords=[dict(seed=a, productOrdinal=b, scenario=c, day=d, word=word(a,b,c,d)) for a,b,c,d in coordinates],
                cases=[dict(name=name,input=data,expected=simulation(data)) for name,data in inputs])


expected = generate()
path = ROOT / "fixtures" / "simulation-vectors.json"
if "--write" in sys.argv:
    path.write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
else:
    actual = json.loads(path.read_text(encoding="utf-8"))
    assert actual == expected, "Golden vectors differ from independent Python oracle"
    print(f"Python oracle: {len(expected['randomWords'])} random words and {len(expected['cases'])} simulations verified")
