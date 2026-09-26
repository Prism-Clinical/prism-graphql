# Evaluation interpreter — discovery records

Evidence for `docs/superpowers/specs/2026-09-26-evaluation-interpreter-design.md`. Everything here was produced
read-only on 2026-09-26 against `main` @ `d377465` (the live build).

| File | Contents |
|---|---|
| `A-runtime.md` | Runtime flows and persistence: every mutation, transactions, CAS/retries, hashes, admin contract |
| `B-interpreter.md` | Interpreter core: every status writer, scheduling, gate/DP/override semantics, defect register D-1…D-15 |
| `C-facts.md` | Condition representations, legacy/kernel dispatch, fact readers/writers, temporal policy, LLM observations, questions |
| `D-downstream.md` | Scoring, findings, safety, readiness, hashing, composition, care-plan projection |
| `E-corpus.md`, `E-specs.md`, `E-tests.md` | Live pathway catalog, intended semantics from prior specs, test catalog |
| `probes/graphs/*.json` | `pathwayGraph` exports of the stored pathways (by `pathway_graph_index.id`) and synthetic graphs (`syn-*`) |
| `probes/*.js`, `probes/*.ts` | Probe scripts that drive the compiled engine on those graphs |

## Re-running the probes

The probes `require` the compiled service at `<repo root>/apps/pathway-service/dist`, resolved relative to
their own location (five directories up). To reproduce:

```bash
git checkout d377465            # the build the findings describe
npm ci
npm run build --prefix apps/pathway-service
node docs/superpowers/records/evaluation-interpreter/probes/probeB.js
npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' \
  docs/superpowers/records/evaluation-interpreter/probes/order-probe.ts
```

The scripts were run from a scratch directory during discovery. Their build paths were then rewritten to be
repo-relative. **They have not been re-run from this location.** Expect to adjust a path if one was missed.

`probes/graphs/<uuid>.json` are live pathway definitions (clinical content, no patient data). Session ids
in the reports refer to synthetic preview sessions.
