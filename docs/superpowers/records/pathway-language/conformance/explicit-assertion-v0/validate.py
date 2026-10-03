#!/usr/bin/env python3
"""Structural validator for the explicit-assertion-v0 fixtures.

It checks format, references, case coverage, canonical ordering and the
canonicalization fixtures (CANONICALIZATION.md). It is NOT an evaluator: it never
computes an expected evidence result, cause, Need or trace fact.
Usage: python3 validate.py
"""
import copy, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CAUSES = ["Missing", "Conflicting", "Unavailable", "Invalid", "Inadmissible", "InsufficientEvidence"]
MARKERS = ["excluded", "unknown"]
REV_DECL = {"key": {"source", "localId"}, "revision": None, "recordType": None, "subject": None,
            "supersedes": {"source", "localId", "revision"}, "episode": None, "encounter": None,
            "concept": {"system", "code"}, "assertion": None, "assertionKind": None,
            "author": {"actor", "permissions"}, "provenance": {"acquisition", "sourceRecordRef"}}
errors = []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def payload(occ):
    """Normalized payload per CANONICALIZATION.md sections 1-5 (revisions only)."""
    out, undeclared = {}, []
    for k, v in occ.items():
        if k not in REV_DECL:
            undeclared.append(k)
            continue
        sub = REV_DECL[k]
        if isinstance(sub, set) and isinstance(v, dict):
            undeclared += [f"{k}.{k2}" for k2 in v if k2 not in sub]
            v = {k2: v2 for k2, v2 in v.items() if k2 in sub}
        out[k] = copy.deepcopy(v)
    for k in ("key", "revision", "provenance"):
        out.pop(k, None)
    perms = out.get("author", {}).get("permissions") if isinstance(out.get("author"), dict) else None
    if isinstance(perms, list) and all(isinstance(p, str) for p in perms):
        out["author"]["permissions"] = sorted(set(perms), key=lambda s: s.encode("utf-16-be"))
    return out, sorted(undeclared)


def canonical(p):
    s = json.dumps(p, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if not s.isascii():
        raise ValueError("this validator only supports ASCII payloads (RFC 8785 escaping not reimplemented)")
    return s


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def id_key(i):
    """Canonical order of revision/variant ids: (source, localId, revision, digest) by code point."""
    if i in MARKERS:
        return (1, MARKERS.index(i))
    rev_part, _, dig = i.partition("#")
    keypart, _, rev = rev_part.partition("@")
    src, _, lid = keypart.partition("/")
    return (0, src, lid, rev, dig)


def check_sorted(where, lst, key):
    if lst != sorted(lst, key=key):
        err(where, f"not in canonical order: {lst}")


def vid(occ):
    k = occ["key"]
    return f'{k["source"]}/{k["localId"]}@{occ["revision"]}#' + sha(canonical(payload(occ)[0]))


def main():
    fx_dir = os.path.join(HERE, "fixtures")
    fixtures = {}
    for name in sorted(os.listdir(fx_dir)):
        path = os.path.join(fx_dir, name)
        try:
            fx = json.load(open(path))
        except json.JSONDecodeError as e:
            err(name, f"invalid JSON: {e}")
            continue
        if fx.get("id") + ".json" != name:
            err(name, "file name does not match id")
        if fx["id"] in fixtures:
            err(name, "duplicate id")
        fixtures[fx["id"]] = fx

    index = json.load(open(os.path.join(HERE, "index.json")))
    referenced = set()
    for case, ids in index["cases"].items():
        for i in ids:
            referenced.add(i)
            if i not in fixtures:
                err("index", f"case {case} references missing fixture {i}")
            elif int(case) not in fixtures[i]["contractCases"]:
                err(i, f"index maps case {case} but fixture does not declare it")
    if sorted(map(int, index["cases"])) != list(range(1, 72)):
        err("index", "contract cases 1-71 not all mapped")
    for i in fixtures:
        if i not in referenced:
            err("index", f"fixture {i} is not referenced by any case")
    for group in ("pairs", "contrasts"):
        for entry in index[group]:
            for i in entry.get("fixtures", [entry.get("before"), entry.get("after")]):
                if i not in fixtures:
                    err("index", f"{group} references missing fixture {i}")

    query = json.load(open(os.path.join(HERE, "query", "q.demo.json")))
    for i, fx in fixtures.items():
        kind = fx["kind"]
        if kind == "canonicalization":
            raws = fx["input"]["rawOccurrences"]
            seen = []
            for v in fx["expected"]["variants"]:
                if sha(v["canonicalBytes"]) != v["digest"]:
                    err(i, "digest does not match canonicalBytes")
                for o in v["occurrences"]:
                    seen.append(o)
                    got = canonical(payload(json.loads(raws[o]))[0])
                    if got != v["canonicalBytes"]:
                        err(i, f"occurrence {o} canonicalizes to {got}")
            if sorted(seen) != list(range(len(raws))):
                err(i, "occurrences not partitioned into variants")
            if fx["expected"]["equalPayload"] != (len(fx["expected"]["variants"]) == 1):
                err(i, "equalPayload inconsistent with variants")
            for u in fx["expected"]["undeclaredFields"]:
                if payload(json.loads(raws[u["occurrence"]]))[1] != sorted(u["paths"]):
                    err(i, "undeclared fields mismatch")
            continue
        if kind in ("compilation", "preview"):
            if "inline" not in fx["query"]:
                err(i, "authoring fixture must inline its full query")
            continue
        # evaluation fixtures
        if fx["query"].get("file") != "../query/q.demo.json" or query["contractDigest"] != fx["query"]["contractDigest"]:
            err(i, "query reference mismatch")
        exp = fx["expected"]
        ev = exp["evidence"]
        if not str(json.dumps(fx)).isascii():
            err(i, "non-ASCII content")
        if ev["status"] == "Known":
            check_sorted(i + " supportingEvidenceIds", ev["supportingEvidenceIds"], id_key)
            want = {"value": "True" if ev["value"] else "False"}
            if exp["causeAttribution"]:
                err(i, "Known result with cause attribution")
            if exp["needs"]["evidence"] or exp["needs"]["obligations"]:
                err(i, "Known result with Needs")
        else:
            check_sorted(i + " causes", ev["causes"], CAUSES.index)
            check_sorted(i + " candidateEvidenceIds", ev["candidateEvidenceIds"], id_key)
            want = {"value": "Unknown", "causes": ev["causes"]}
            if sorted({a["cause"] for a in exp["causeAttribution"]}, key=CAUSES.index) != ev["causes"]:
                err(i, "attributed causes differ from evidence causes")
            check_sorted(i + " causeAttribution", [(CAUSES.index(a["cause"]), a["origin"]) for a in exp["causeAttribution"]], None)
            n = exp["needs"]
            if n["evidence"] is None and n["deferred"] is None:
                err(i, "Unresolved result without evidence Need or deferral")
            if n["evidence"] is not None and n["evidence"]["causes"] != ev["causes"]:
                err(i, "Need state causes differ from result causes")
            check_sorted(i + " obligations", [(o["kind"], o.get("record", "")) for o in n["obligations"]], None)
        if exp["decision"] != want:
            err(i, "decision is not the projection of evidence")
        recs = fx["input"]["records"]
        for t in exp["traceAssertions"]:
            if t["fact"] == "variants":
                computed = sorted({vid(o) for o in recs
                                   if f'{o["key"]["source"]}/{o["key"]["localId"]}@{o["revision"]}' == t["ref"]}, key=id_key)
                if computed != t["value"]:
                    err(i, f"variant ids for {t['ref']} do not match payload digests")
            if t["fact"] == "keyResult" and "possibleCurrent" in t:
                check_sorted(i + " possibleCurrent", t["possibleCurrent"], id_key)

    for p in index["pairs"]:
        a, b = fixtures[p["before"]]["expected"], fixtures[p["after"]]["expected"]
        if (a["evidence"], a["decision"], a["needs"]) != (b["evidence"], b["decision"], b["needs"]):
            err("pair", f'{p["before"]}/{p["after"]} results differ')

    if errors:
        print("\n".join(errors))
        sys.exit(1)
    print(f"OK: {len(fixtures)} fixtures, {len(index['cases'])} contract cases, {len(index['pairs'])} pairs")


if __name__ == "__main__":
    main()
