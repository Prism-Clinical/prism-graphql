# Try PPL

**Experimental and nonclinical.** These files are a fictional schematic program and fictional records. Running them evaluates nothing about a real patient, and a result is never a clinical recommendation.

`try:ppl` is a small developer command. It compiles an editable PPL program, evaluates it against an editable scenario with the existing raw-record executor, and prints the result. It adds no language behaviour of its own.

## Setup

You need Node 18 or later; this was tested on Node 20.20.0. Run every command from the package directory:

```bash
cd libs/pathway-language     # from the prism-graphql checkout
npm install                  # once
```

That's all. Each run of `npm run try:ppl` rebuilds the package (about 2 seconds) and then runs it, so the output never comes from a stale build.

## Run it

```bash
npm run -s try:ppl -- --program try/programs/schematic.ppl.json --scenario try/scenarios/established.json
npm run -s try:ppl -- --program try/programs/schematic.ppl.json --scenario try/scenarios/refuted.json
npm run -s try:ppl -- --program try/programs/schematic.ppl.json --scenario try/scenarios/missing.json
npm run -s try:ppl -- --program try/programs/schematic.ppl.json --scenario try/scenarios/conflicting.json
npm run -s try:ppl -- --program try/programs/schematic-preview.ppl.json --scenario try/scenarios/refuted.json --preview
```

`-s` hides npm's own banner. File paths are relative to `libs/pathway-language`.

| Option | Effect |
|---|---|
| `--preview` | Compiles for preview, so authoring holes become markers and publication stays blocked. Without it, normal compilation refuses any program that has a hole. The command never switches modes by itself. |
| `--json` | Prints the compile outcome and the engine's result unchanged, structured record references included, instead of the readable summary. |

## The files to edit

| File | What it is |
|---|---|
| `programs/schematic.ppl.json` | A complete program: one evidence query `q.demo`, which reads fictional `DemoAssessment` records, a predicate `p.demo`, and the Finding `f.demo`. It starts as a copy of `docs/superpowers/records/pathway-language/programs/schematic-demo-finding.ppl.json`. |
| `programs/schematic-preview.ppl.json` | The same program plus a second query `q.alt`, whose `establishes` criterion is the authoring hole `H-ALT-EST`. `f.demo` reads only `q.demo`; `f.both` reads both queries. This is the PPL-08a program. |
| `scenarios/*.json` | One patient context and its records. Each scenario copies the input of a conformance fixture (EA-001, EA-002, EA-005 and EA-007). |

In the program file, `establishes` and `refutes` are the rules that make a record count for or against the Finding. `admissible` decides which records may be used at all: the same episode, the same encounter and an allowed `assertionKind`.

**Scenario format.** A scenario is the `input` block of the acceptance examples, minus `clock`, `mode` and `supersedesSnapshot`, which the executor never reads. It is mapped to the engine like this, with nothing defaulted:

| Scenario field | Engine input |
|---|---|
| `context.subject` | `subject` |
| `context.episode` | `contextEpisode`, either `{"known": "E1"}` or `{"unknown": ["Missing"]}` |
| `context.encounter` | `contextEncounter`, in the same forms |
| `records` | `revisions` |
| `retractions` | `retractions` |
| `snapshot`, `coverage`, `failures`, `rejectedItems` | `snapshot: {id, coverage, failures, rejectedItems}` |
| `description` (optional) | Display text only |

Every other field is rejected, and every field in the table except `description` is required. Write `[]` when there are none.

## Expected outcomes

| Command | `f.demo` | Why |
|---|---|---|
| `schematic` + `established` | **True**: the Finding is established | One current Affirmed record (`s1/r1@1`), admissible, with complete coverage |
| `schematic` + `refuted` | **False**: the Finding is refuted | One current Denied record (`s1/r2@1`). False means only that this Finding is refuted; it does not mean the patient is fine |
| `schematic` + `missing` | **Unknown(Missing)** | No record. Complete coverage still does not make absence a negative |
| `schematic` + `conflicting` | **Unknown(Conflicting)** | Affirmed in `s1` and Denied in `s2`, both admissible. The candidate records are listed |
| `schematic-preview` + `refuted`, `--preview` | `f.demo` **False**; `f.both` **Marker[H-ALT-EST]** | The program has an unfinished rule, but `f.demo` doesn't depend on it |
| `schematic-preview` + `refuted`, no `--preview` | Not run | Compilation is refused with `UNRESOLVED_AUTHORING_HOLE`, and nothing is executed |

What the four status words mean:

- **True**: the Finding is established by this scenario.
- **False**: the Finding is refuted by this scenario.
- **Unknown(causes)**: the available evidence does not resolve it. The causes are patient-evidence causes, such as `Missing` or `Conflicting`.
- **Marker[hole]**: the rule it depends on is unfinished. This is an authoring state, not patient uncertainty.

## Sample output

```text
PPL trial runner (experimental, nonclinical: not for patient care)
Program:  try/programs/schematic.ppl.json  (package schematic.demo-finding)
Scenario: try/scenarios/conflicting.json
          Fictional, nonclinical. An Affirmed record in s1 and a Denied record in s2, both admissible (input of EA-007).
Mode:     normal
Compile:  Compiled, 0 diagnostics
Authoring: complete (no holes)
Snapshot: snap-1

Findings
  f.demo  Unknown(Conflicting): the available evidence does not resolve it
    label: "Schematic finding: demonstration item affirmed (nonclinical)"
    candidates: s1/r1@1, s2/r2@1

Queries
  q.demo  Unresolved(Conflicting)  candidates: s1/r1@1, s2/r2@1
    causes, as attributed by S6:
      Conflicting from S6: AssertionConflict  [query]
```

The program trace follows. Each line gives an output, the JSON Pointer of the source that produced it, its result, and the engine's explanation.

## Exercises

Copy a file before editing it, or reset it afterwards with `git checkout -- try/`.

1. **Change an assertion.** In `scenarios/established.json`, change `"assertion": "Affirmed"` to `"Denied"` and rerun. `f.demo` becomes **False**, supported by `s1/r1@1`.
2. **Change the authored criterion.** In `programs/schematic.ppl.json`, swap the values of `establishes` and `refutes`, so that Denied establishes and Affirmed refutes. Rerun with `established`: `f.demo` is **False**.
   - Now make `refutes` identical to `establishes`. The compiler refuses the program with `EXCLUSIVE_BRANCH_OVERLAP`, because the two criteria must be disjoint, and nothing runs.
   - A variant: set `admissible.assertionKind` to `{"in": ["PatientReport"]}`. The ClinicianDocumented record is then not admissible, and `f.demo` is **Unknown(Inadmissible)**.
3. **Remove evidence.** Set `"records": []` in `scenarios/established.json`. `f.demo` becomes **Unknown(Missing)**, never False.
4. **Preview a hole.** In `programs/schematic.ppl.json`, replace the whole `refutes` value with
   `{"hole": {"id": "H-REFUTES", "type": "Decision", "explains": "refutes not decided yet"}}`.
   - Without `--preview`, compilation is refused with `UNRESOLVED_AUTHORING_HOLE`.
   - With `--preview`, `f.demo` is **Marker[H-REFUTES]**. The query section shows what still runs: stages S1–S5, and for each record `establishes True, refutes Marker[H-REFUTES]`. No S6 runs and no `Evidence<Boolean>` is produced.
   - Compare with `schematic-preview.ppl.json`, where the hole is in a different query and `f.demo` stays determinate.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Evaluated. This includes Unknown evidence and a preview with markers |
| 1 | The compiler refused the program. Diagnostics are printed with their source pointers, and nothing runs |
| 2 | Usage, file or JSON error, or a scenario field that is unsupported or missing |
| 3 | The engine rejected the runtime input: `RawExecutionConfigurationError` or `RawPreviewConfigurationError`, for example for a malformed `episode` binding |
| 70 | Unexpected internal error, an engine or runner defect. The stack trace is printed. This is never reported as patient uncertainty |

## What it shows, and what it cannot explain yet

**Shown:**
- the compile outcome and its diagnostics;
- authoring holes and the publication state;
- each Finding's status with its supporting or candidate records;
- its label, heading and cites;
- each query's evidence, and for unresolved evidence, the causes as S6 attributed them;
- for a holed query, the stages that ran and each record's criterion values;
- the program trace, with source pointers.

**Not shown, because the engine doesn't return it:**
- **Per-record criterion values for a complete query.** Its trace holds S6 summaries and attributions only. `--json` gives the full S6 trace, which includes the earlier S6 steps.
- **Needs, obligations, acquisition and conflict resolution.** None are run here. Program-level Need materiality isn't implemented.
- **Some S1 history causes.** The S1 fork-fallback limitation (EA-083/EA-092) still applies, so these causes are for inspection only.

**Language limits:**
- Only the first compiler subset exists. A program has one applicability predicate, `explicit-assertion-v0` evidence queries, `evidenceValue`, `all`, and Findings.
- There is one fictional record model, `demo-model/DemoAssessment@0.1`, and one correction-authority rule.
- There is no clock or recency, and no other policy.
