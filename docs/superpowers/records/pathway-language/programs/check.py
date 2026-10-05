#!/usr/bin/env python3
"""Mechanical checks for the proposed first PPL programs and their acceptance examples.

This is NOT a compiler, evaluator or language-conformance test. It never computes an expected
output. It checks only:
- every JSON file parses;
- declaration references and citations resolve, and the derived dependency graph is acyclic;
- source quotations match the pinned corpus file, whose SHA-256 matches the manifest;
- finding label and heading text occur verbatim in the quoted lines;
- each example's program link, patch and JSON Pointers resolve;
- each example's dependency edges equal the edges derived from the program's references;
- each example's hole diagnostics and markers name holes that exist in the program;
- every diagnostic code is one of the named codes of the implementation contract (section 5);
- no example promises a Need, which is deferred from this slice, and no example of a program with
  holes claims any patient-data request;
- examples based on an EA fixture use that fixture's input verbatim, and the claimed outputs equal
  the fixture's expected values;
- the schematic query contract and value sets equal the pinned q.demo.json ones;
- every corpus file still matches its manifest digest.

Usage: python3 check.py
"""
import copy, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.dirname(HERE)
CONF = os.path.join(REC, "conformance", "explicit-assertion-v0")
errors = []
# Mirrors first-program-implementation-contract.md section 5 (existing Stage A codes plus the subset's additions).
CODES = {
    "SOURCE_INVALID", "UNKNOWN_EXECUTABLE_PROPERTY", "INVALID_DECLARATION_ID", "UNDEFINED_REFERENCE",
    "TYPE_MISMATCH", "UNSUPPORTED_CONTEXT_REFERENCE", "UNSUPPORTED_CONSTRUCT", "CYCLIC_EXECUTION_DEPENDENCY",
    "EXCLUSIVE_BRANCH_OVERLAP", "UNSUPPORTED_PROOF_FRAGMENT", "UNRESOLVED_AUTHORING_HOLE",
}
REQUEST_KEYS = {"evidenceNeed", "needs", "patientDataRequest", "patientDataRequests"}


def err(where, msg):
    errors.append(f"{where}: {msg}")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def pointer(doc, ptr):
    """RFC 6901 JSON Pointer lookup; raises KeyError/IndexError if absent."""
    if ptr == "":
        return doc
    for raw in ptr.lstrip("/").split("/"):
        tok = raw.replace("~1", "/").replace("~0", "~")
        doc = doc[int(tok)] if isinstance(doc, list) else doc[tok]
    return doc


def apply_patch(doc, patch):
    """RFC 6902 subset: `replace` only (all the examples need)."""
    doc = copy.deepcopy(doc)
    for op in patch:
        if op["op"] != "replace":
            raise ValueError(f"unsupported patch op {op['op']}")
        *parent, last = op["path"].lstrip("/").split("/")
        target = pointer(doc, "/" + "/".join(parent)) if parent else doc
        pointer(doc, op["path"])  # must exist
        target[int(last) if isinstance(target, list) else last] = op["value"]
    return doc


def walk(node, path=""):
    yield path, node
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}/{i}")


def declarations(prog):
    decls = {prog["applicability"]["id"]: ("/applicability", prog["applicability"])}
    for i, n in enumerate(prog["nodes"]):
        decls[n["id"]] = (f"/nodes/{i}", n)
    return decls


def derived_edges(prog, where):
    """Edges (reader, read) from `ref`s, excluding `ctx.*` context bindings inside query contracts."""
    decls = declarations(prog)
    edges, bad = set(), []
    for did, (base, d) in decls.items():
        for path, v in walk(d, base):
            if isinstance(v, dict) and "ref" in v and isinstance(v["ref"], str):
                ref = v["ref"]
                if ref.startswith("ctx."):
                    if "/contract/" not in path + "/":
                        bad.append(f"{path}: context binding {ref} outside a query contract")
                    continue
                if ref not in decls:
                    bad.append(f"{path}: undefined reference {ref}")
                else:
                    edges.add((did, ref))
    return sorted(map(list, edges)), bad


def holes(prog):
    return {v["hole"]["id"]: p + "/hole" for p, v in walk(prog) if isinstance(v, dict) and "hole" in v}


def acyclic(edges):
    graph = {}
    for a, b in edges:
        graph.setdefault(a, []).append(b)
    state = {}

    def visit(n):
        if state.get(n) == 1:
            return False
        if state.get(n) == 2:
            return True
        state[n] = 1
        ok = all(visit(m) for m in graph.get(n, []))
        state[n] = 2
        return ok

    return all(visit(n) for n in list(graph))


def check_program(name, prog):
    edges, bad = derived_edges(prog, name)
    for b in bad:
        err(name, b)
    if not acyclic(edges):
        err(name, "executable dependency graph has a cycle")
    refs = {r["id"]: r for r in prog.get("references", [])}
    for did, (base, d) in declarations(prog).items():
        for c in d.get("cites", []):
            if c not in refs:
                err(name, f"{base}: citation {c} undefined")
    for r in refs.values():
        path = os.path.normpath(os.path.join(HERE, r["file"]))
        data = open(path, "rb").read()
        if hashlib.sha256(data).hexdigest() != r["sha256"]:
            err(name, f"{r['id']}: SHA-256 mismatch for {r['file']}")
        lines = data.decode("utf-8").split("\n")
        for ln, text in r.get("quote", {}).items():
            if lines[int(ln) - 1] != text:
                err(name, f"{r['id']}: line {ln} is {lines[int(ln) - 1]!r}, quoted {text!r}")
        for d in prog["nodes"]:
            if d["kind"] == "Finding" and r["id"] in d.get("cites", []):
                quoted = " ".join(r.get("quote", {}).values())
                for field in ("label", "heading"):
                    if field in d and d[field] not in quoted:
                        err(name, f"{d['id']}.{field} is not verbatim source text")
    return edges


def main():
    programs = {}
    for fn in sorted(os.listdir(HERE)):
        if fn.endswith(".ppl.json"):
            programs[fn] = load(os.path.join(HERE, fn))
            check_program(fn, programs[fn])

    q = load(os.path.join(CONF, "query", "q.demo.json"))
    schem = programs["schematic-demo-finding.ppl.json"]
    qd = next(n for n in schem["nodes"] if n["id"] == "q.demo")
    if qd["contract"] != q["query"]["contract"]:
        err("schematic", "q.demo contract differs from conformance q.demo.json")
    if schem["valueSets"] != q["valueSets"]:
        err("schematic", "valueSets differ from conformance q.demo.json")

    ex_dir = os.path.join(HERE, "examples")
    examples = sorted(os.listdir(ex_dir))
    for fn in examples:
        ex = load(os.path.join(ex_dir, fn))
        where = ex["id"]
        if fn != f"{ex['id']}.json":
            err(where, "file name does not match id")
        prog_name = os.path.basename(ex["program"]["file"])
        if prog_name not in programs:
            err(where, f"unknown program {ex['program']['file']}")
            continue
        try:
            prog = apply_patch(programs[prog_name], ex["program"]["patch"])
        except (KeyError, IndexError, ValueError) as e:
            err(where, f"patch does not apply: {e}")
            continue
        exp = ex["expected"]
        comp = exp["compile"]
        for d in comp.get("diagnostics", []):
            if d.get("code") not in CODES:
                err(where, f"diagnostic code {d.get('code')!r} is not a named code of the contract")
            try:
                pointer(prog, d["location"])
            except (KeyError, IndexError, ValueError):
                err(where, f"diagnostic location {d['location']} does not resolve")
        for t in exp.get("trace", []):
            try:
                pointer(prog, t["source"])
            except (KeyError, IndexError, ValueError):
                err(where, f"trace source {t['source']} does not resolve")
        if "dependencyEdges" in comp:
            edges, bad = derived_edges(prog, where)
            if bad or edges != comp["dependencyEdges"]:
                err(where, f"dependencyEdges {comp['dependencyEdges']} != derived {edges} {bad}")
        hs = holes(prog)
        for d in comp.get("diagnostics", []):
            if d.get("code") == "UNRESOLVED_AUTHORING_HOLE" and hs.get(d["hole"]) != d["location"]:
                err(where, f"hole diagnostic {d['hole']} at {d['location']} does not match program")
        if comp.get("outcome") == "CompileFailure" and comp.get("wellFormed") and \
                sorted(d["hole"] for d in comp["diagnostics"]) != sorted(hs):
            err(where, "hole diagnostics do not list exactly the program's holes")
        for m in (exp.get("preview") or {}).get("markers", []):
            if not set(m["holes"]) <= set(hs):
                err(where, f"marker {m} names an unknown hole")
        if not hs and exp["state"] == "IncompleteAuthoring":
            err(where, "IncompleteAuthoring without a hole")
        if hs and exp["state"] in ("EstablishedTrue", "EstablishedFalse", "UnresolvedPatientEvidence"):
            err(where, "patient-evidence state for a program with holes")
        request_keys = {k for _, v in walk(exp) if isinstance(v, dict) for k in v if k in REQUEST_KEYS}
        if hs and request_keys:
            err(where, f"a program with holes must not request patient data ({sorted(request_keys)})")
        elif request_keys:
            err(where, f"Need generation is deferred from this slice; remove {sorted(request_keys)}")
        base = ex.get("basedOn") or {}
        if base.get("fixture", "").startswith("EA-") and ex.get("input") is not None and "q.demo" in (exp.get("outputs") or {}):
            fx = load(os.path.join(CONF, "fixtures", f"{base['fixture']}.json"))
            if ex["input"] != fx["input"]:
                err(where, f"input differs from {base['fixture']}")
            if exp["outputs"]["q.demo"]["evidence"] != fx["expected"]["evidence"]:
                err(where, f"q.demo evidence differs from {base['fixture']}")
            if exp["outputs"]["p.demo"]["decision"] != fx["expected"]["decision"]:
                err(where, f"p.demo decision differs from {base['fixture']}")
            if exp["causeAttribution"] != fx["expected"]["causeAttribution"]:
                err(where, f"causeAttribution differs from {base['fixture']}")

    manifest = load(os.path.join(REC, "corpus", "manifest.json"))
    for f in manifest["files"]:
        data = open(os.path.join(REC, "corpus", f["file"]), "rb").read()
        if hashlib.sha256(data).hexdigest() != f["sha256"]:
            err("corpus", f"{f['file']} no longer matches its manifest digest")

    if errors:
        print("\n".join(errors))
        sys.exit(1)
    print(f"OK: {len(programs)} programs, {len(examples)} examples, {len(manifest['files'])} corpus files unchanged "
          "(mechanical checks only; not language conformance)")


if __name__ == "__main__":
    main()
