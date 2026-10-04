#!/usr/bin/env python3
"""Load the full ICD-10-CM code set into `icd10_codes`.

The migrations seed only a common-codes subset (045). Pathway trigger codes are
authored as FAMILIES, and the matcher finds a family by walking a patient
code's ancestors in this table — so a code missing here cannot match through
its parent. This loads every code and every header level from the CMS order
file, with the ltree `path` the hierarchy queries use.

Source: CMS "Code Descriptions in Tabular Order" (icd10cm_order_<year>.txt),
https://www.cms.gov/medicare/coding-billing/icd-10-codes — not committed.

Usage (prints SQL; pipe it to psql):
  python3 scripts/load-icd10cm.py icd10cm_order_2026.txt \\
    | docker exec -i healthcare-postgres psql -U postgres -d healthcare_federation -v ON_ERROR_STOP=1

Idempotent: existing rows are updated in place (the seed's "<auto-added parent
of …>" placeholders get their real descriptions).
"""
import sys


def dotted(raw: str) -> str:
    return raw if len(raw) <= 3 else f"{raw[:3]}.{raw[3:]}"


def main() -> None:
    rows = []  # (raw, billable, long description)
    with open(sys.argv[1], encoding="utf-8") as f:
        for line in f:
            if len(line) < 78:
                continue
            raw = line[6:13].strip()
            rows.append((raw, line[14] == "1", line[77:].strip()))

    known = {raw for raw, _, _ in rows}
    description = {raw: d for raw, _, d in rows}

    def parent_of(raw: str):
        for n in range(len(raw) - 1, 2, -1):
            if raw[:n] in known:
                return raw[:n]
        return None

    def path_of(raw: str) -> str:
        chain = [raw]
        while (p := parent_of(chain[-1])) is not None:
            chain.append(p)
        return ".".join(dotted(c).replace(".", "_") for c in reversed(chain))

    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    print("BEGIN;")
    # Parents before children: the parent_code foreign key is checked per row.
    for raw, billable, desc in sorted(rows, key=lambda r: (len(r[0]), r[0])):
        parent = parent_of(raw)
        category = raw[:3]
        print(
            "INSERT INTO icd10_codes (code, description, category, category_description, is_billable, parent_code, path) VALUES ("
            f"{q(dotted(raw))}, {q(desc)}, {q(category)}, {q(description.get(category, category))}, "
            f"{'true' if billable else 'false'}, {q(dotted(parent)) if parent else 'NULL'}, {q(path_of(raw))}) "
            "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, "
            "category_description = EXCLUDED.category_description, is_billable = EXCLUDED.is_billable, "
            "parent_code = EXCLUDED.parent_code, path = EXCLUDED.path;"
        )
    print("COMMIT;")


if __name__ == "__main__":
    main()
