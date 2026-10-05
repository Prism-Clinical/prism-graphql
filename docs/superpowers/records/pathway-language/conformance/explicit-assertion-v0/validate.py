#!/usr/bin/env python3
"""Structural validator for the explicit-assertion-v0 fixtures.

Checks format, references, case coverage, canonical ordering, pair relationships and
the canonicalization fixtures. It is NOT an evaluator: it never computes an expected
evidence result, cause, Need or trace fact.

Canonicalization subset (README, "Canonicalization checks"): this helper serializes
null, booleans, strings, arrays and objects per RFC 8785. It does NOT serialize
numbers. Any payload containing a number is reported as deferred, never as verified.
Such payloads are verified by check-canonical.cjs, which uses a maintained RFC 8785
implementation.

Usage: python3 validate.py [--self-test]
"""
import copy, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CASE_RANGE = range(1, 108)
CAUSES = ["Missing", "Conflicting", "Unavailable", "Invalid", "Inadmissible", "InsufficientEvidence"]
MARKERS = ["excluded", "unknown"]
REV_DECL = {"key": {"source", "localId"}, "revision": None, "recordType": None, "subject": None,
            "supersedes": {"source", "localId", "revision"}, "episode": None, "encounter": None,
            "concept": {"system", "code"}, "assertion": None, "assertionKind": None,
            "author": {"actor", "permissions"}, "provenance": {"acquisition", "sourceRecordRef"}}


class Unsupported(ValueError):
    """Input that RFC 8785 / I-JSON cannot represent (CANONICALIZATION.md section 7)."""


class OutsideSubset(ValueError):
    """Valid RFC 8785 input that this helper deliberately does not serialize (numbers)."""


def _reject_constant(tok):
    raise Unsupported(f"non-finite number {tok}")


def _no_duplicates(pairs):
    keys = [k for k, _ in pairs]
    if len(keys) != len(set(keys)):
        raise Unsupported("duplicate member name")
    return dict(pairs)


def strict_loads(text):
    return json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_reject_constant)


def payload(occ):
    """Normalized payload per CANONICALIZATION.md sections 1-5 (revisions)."""
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
    perms = out["author"].get("permissions") if isinstance(out.get("author"), dict) else None
    if isinstance(perms, list) and all(isinstance(p, str) for p in perms):
        out["author"]["permissions"] = sorted(set(perms), key=lambda s: s.encode("utf-16-be"))
    return out, sorted(undeclared)


_ESC = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}


def es_string(s):
    """RFC 8785 section 3.2.2.2 string serialization."""
    out = []
    for ch in s:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            raise Unsupported("lone surrogate")
        out.append(_ESC.get(ch) or ("\\u%04x" % ord(ch) if ord(ch) < 0x20 else ch))
    return '"' + "".join(out) + '"'


def canonical(v):
    """RFC 8785 serialization for the number-free subset."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        raise OutsideSubset("numbers are verified by check-canonical.cjs, not by this helper")
    if isinstance(v, str):
        return es_string(v)
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    if isinstance(v, dict):
        items = sorted(v.items(), key=lambda kv: kv[0].encode("utf-16-be"))
        return "{" + ",".join(es_string(k) + ":" + canonical(x) for k, x in items) + "}"
    raise Unsupported(f"unsupported value type {type(v).__name__}")


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


def rev_ref(o):
    return f'{o["key"]["source"]}/{o["key"]["localId"]}@{o["revision"]}'


def load():
    errors, fixtures = [], {}
    fx_dir = os.path.join(HERE, "fixtures")
    for name in sorted(os.listdir(fx_dir)):
        try:
            fx = strict_loads(open(os.path.join(fx_dir, name), encoding="utf-8").read())
        except (json.JSONDecodeError, Unsupported) as e:
            errors.append(f"{name}: invalid JSON: {e}")
            continue
        if fx.get("id") + ".json" != name:
            errors.append(f"{name}: file name does not match id")
        if fx["id"] in fixtures:
            errors.append(f"{name}: duplicate id")
        fixtures[fx["id"]] = fx
    index = strict_loads(open(os.path.join(HERE, "index.json"), encoding="utf-8").read())
    query = strict_loads(open(os.path.join(HERE, "query", "q.demo.json"), encoding="utf-8").read())
    return fixtures, index, query, errors


def check(fixtures, index, query):
    """Return (errors, deferred) for the given in-memory fixture set."""
    errors, deferred = [], []

    def err(where, msg):
        errors.append(f"{where}: {msg}")

    def check_sorted(where, lst, key):
        if lst != sorted(lst, key=key):
            err(where, f"not in canonical order: {lst}")

    referenced = set()
    for case, ids in index["cases"].items():
        for i in ids:
            referenced.add(i)
            if i not in fixtures:
                err("index", f"case {case} references missing fixture {i}")
            elif int(case) not in fixtures[i]["contractCases"]:
                err(i, f"index maps case {case} but fixture does not declare it")
    if sorted(map(int, index["cases"])) != list(CASE_RANGE):
        err("index", f"contract cases {CASE_RANGE.start}-{CASE_RANGE.stop - 1} not all mapped")
    for i in fixtures:
        if i not in referenced:
            err("index", f"fixture {i} is not referenced by any case")
    for group in ("pairs", "contrasts", "historyResolution"):
        for entry in index[group]:
            ids = entry.get("fixtures") or [entry.get("before"), entry.get("after")] + entry.get("controls", [])
            for i in ids:
                if i not in fixtures:
                    err("index", f"{group} references missing fixture {i}")

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
                    try:
                        got = canonical(payload(strict_loads(raws[o]))[0])
                    except OutsideSubset:
                        deferred.append(f"{i} occurrence {o}")
                        continue
                    except Unsupported as e:
                        err(i, f"occurrence {o} is not representable under RFC 8785: {e}")
                        continue
                    if got != v["canonicalBytes"]:
                        err(i, f"occurrence {o} canonicalizes to {got}")
            if sorted(seen) != list(range(len(raws))):
                err(i, "occurrences not partitioned into variants")
            if fx["expected"]["equalPayload"] != (len(fx["expected"]["variants"]) == 1):
                err(i, "equalPayload inconsistent with variants")
            for u in fx["expected"]["undeclaredFields"]:
                if payload(strict_loads(raws[u["occurrence"]]))[1] != sorted(u["paths"]):
                    err(i, "undeclared fields mismatch")
            continue
        if kind in ("compilation", "preview"):
            if "inline" not in fx["query"]:
                err(i, "authoring fixture must inline its full query")
            continue
        if fx["query"].get("file") != "../query/q.demo.json" or query["contractDigest"] != fx["query"]["contractDigest"]:
            err(i, "query reference mismatch")
        exp = fx["expected"]
        ev = exp["evidence"]
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
            check_sorted(i + " causeAttribution",
                         [(CAUSES.index(a["cause"]), a["origin"], a["reason"]) for a in exp["causeAttribution"]], None)
            n = exp["needs"]
            if n["evidence"] is None and n["deferred"] is None:
                err(i, "Unresolved result without evidence Need or deferral")
            if n["evidence"] is not None and n["evidence"]["causes"] != ev["causes"]:
                err(i, "Need state causes differ from result causes")
            check_sorted(i + " obligations", [(o["kind"], o.get("record", "")) for o in n["obligations"]], None)
        if exp["decision"] != want:
            err(i, "decision is not the projection of evidence")
        historical = {(t.get("cause"), t.get("reason")) for t in exp["traceAssertions"]
                      if t["fact"] == "diagnostic" and t["code"] == "HistoricalDefect"}
        for a in exp["causeAttribution"]:
            if (a["cause"], a["reason"]) in historical and a["origin"] in {
                    t["ref"].split("@")[0] for t in exp["traceAssertions"] if t.get("code") == "HistoricalDefect"}:
                err(i, f"historical defect {a['reason']} also listed as an active cause")
        recs = fx["input"]["records"]
        for t in exp["traceAssertions"]:
            if t["fact"] == "variants":
                try:
                    computed = sorted({rev_ref(o) + "#" + sha(canonical(payload(o)[0]))
                                       for o in recs if rev_ref(o) == t["ref"]}, key=id_key)
                except OutsideSubset:
                    deferred.append(f"{i} variants {t['ref']}")
                    continue
                if computed != t["value"]:
                    err(i, f"variant ids for {t['ref']} do not match payload digests")
            if t["fact"] == "keyResult" and "possibleCurrent" in t:
                check_sorted(i + " possibleCurrent", t["possibleCurrent"], id_key)

    for p in index["pairs"]:
        if p["before"] not in fixtures or p["after"] not in fixtures:
            continue
        fa, fb = fixtures[p["before"]], fixtures[p["after"]]
        a, b = fa["expected"], fb["expected"]
        if p["compare"] == "result":
            # Before/after a proven boundary attempt: diagnostics and trace may legitimately differ.
            if (a["evidence"], a["decision"], a["needs"]) != (b["evidence"], b["decision"], b["needs"]):
                err("pair", f'{p["before"]}/{p["after"]} results differ')
        elif p["compare"] == "wholeExpected":
            # Input permutation: every expected field, including attribution and trace assertions.
            if a != b:
                diff = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
                err("pair", f'{p["before"]}/{p["after"]} expected outputs differ in {diff}')
            ia, ib = fa["input"], fb["input"]
            norm = lambda xs: sorted(json.dumps(x, sort_keys=True) for x in xs)
            for k in ia:
                same = norm(ia[k]) == norm(ib[k]) if isinstance(ia[k], list) else ia[k] == ib[k]
                if not same:
                    err("pair", f'{p["before"]}/{p["after"]} inputs are not a permutation ({k})')
            if ia == ib:
                err("pair", f'{p["before"]}/{p["after"]} inputs are identical, not permuted')
        else:
            err("pair", f'unknown compare mode {p["compare"]}')

    for h in index["historyResolution"]:
        if all(x in fixtures for x in [h["before"], h["after"]] + h["controls"]):
            if fixtures[h["before"]]["expected"]["evidence"]["status"] != "Unresolved":
                err("historyResolution", f'{h["before"]} should be the unresolved before-state')
            if fixtures[h["after"]]["expected"]["evidence"]["status"] != "Known":
                err("historyResolution", f'{h["after"]} should be the resolved after-state')
            for c in h["controls"]:
                if fixtures[c]["expected"]["evidence"]["status"] != "Unresolved":
                    err("historyResolution", f"control {c} should remain unresolved")
    return errors, deferred


def self_test(fixtures, index, query):
    """Negative checks on in-memory copies; committed files are never modified."""
    def mutated(fx_id, change):
        fx = copy.deepcopy(fixtures)
        change(fx[fx_id]["expected"])
        return check(fx, index, query)[0]

    def bump_reason(e):
        e["causeAttribution"][0]["reason"] = "Fork"

    def add_trace(e):
        e["traceAssertions"].append({"fact": "rule", "value": 1})

    def add_diagnostic(e):
        e["traceAssertions"].append({"fact": "diagnostic", "code": "CrossKeyCorrection", "ref": "s1/r1"})

    def change_result(e):
        e["evidence"]["supportingEvidenceIds"] = ["s2/r21@1"]

    tests = [
        ("permutation pair: cause attribution only", mutated("EA-071", bump_reason), "EA-070/EA-071 expected outputs differ"),
        ("permutation pair: trace assertions only", mutated("EA-071", add_trace), "EA-070/EA-071 expected outputs differ"),
        ("result pair: added diagnostic is allowed", mutated("EA-022", add_diagnostic), None),
        ("result pair: changed result is rejected", mutated("EA-022", change_result), "EA-001/EA-022 results differ"),
    ]
    failed = 0
    for name, errs, expect in tests:
        ok = (not errs) if expect is None else any(expect in e for e in errs)
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}: {name}" + ("" if ok else f" -> {errs}"))
    return failed


def main():
    fixtures, index, query, load_errors = load()
    errors, deferred = check(fixtures, index, query)
    errors = load_errors + errors
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    print(f"OK: {len(fixtures)} fixtures, {len(index['cases'])} contract cases, "
          f"{len(index['pairs'])} pairs, {len(index['historyResolution'])} history-resolution groups")
    print(f"Deferred to check-canonical.cjs (numbers, outside this helper's subset): {len(deferred)}")
    if "--self-test" in sys.argv:
        sys.exit(1 if self_test(fixtures, index, query) else 0)


if __name__ == "__main__":
    main()
