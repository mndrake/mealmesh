"""Capture golden output from the read-only recipe-repo Python tools.

Run with the repo venv:  /tmp/mmvenv/bin/python app/scripts/gen_fixtures.py
Emits JSON fixtures the TS planner/shopping ports are asserted against, so the
ports are checked for *exact* parity with the original deterministic logic.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))            # mealmesh/
BUILD = os.path.join(ROOT, "recipe-repo", "build")
OUT = os.path.join(os.path.dirname(HERE), "src", "lib", "__fixtures__")
sys.path.insert(0, BUILD)

import loader, planner, shopping  # noqa: E402

os.makedirs(OUT, exist_ok=True)


def dump(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False, sort_keys=True)
    print("wrote", os.path.relpath(path, ROOT))


def shopping_json(meals):
    sections, staples = shopping.build_list(meals)
    return {"sections": {s: [list(p) for p in items] for s, items in sections.items()},
            "staples": staples}


rs = loader.load_all()

# 1) Default auto-suggested plan (planner.build_plan defaults) + its shopping list.
plan, _ = planner.build_plan(rs)
dump("plan_default.json", {"plan": plan})
dump("shopping_plan_default.json", shopping_json(planner.cooked_meals(plan, rs)))

# 2) Shopping list over a fixed, planner-independent meal set: first 12 recipe ids
#    (sorted), so shopping parity can be tested without depending on the planner.
fixed_ids = sorted(rs)[:12]
dump("shopping_fixed12.json", shopping_json([rs[i] for i in fixed_ids]))
dump("shopping_fixed12_ids.json", {"ids": fixed_ids})

print("done")
