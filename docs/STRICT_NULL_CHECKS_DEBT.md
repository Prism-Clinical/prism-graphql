# Issue: turn on `strictNullChecks` in pathway-service

**Opened:** 2026-09-27, during interpreter phase 1 (`feat/interpreter-01-compiler`).
**Status:** open. This branch records the issue; it does not fix it.

## Problem

`apps/pathway-service/tsconfig.json` sets `noImplicitAny` and `noImplicitReturns`,
but not `strict` or `strictNullChecks`. Without `strictNullChecks`:

- `null` and `undefined` are assignable to every type, so `T | undefined` is
  indistinguishable from `T` and missing values go unchecked.
- A truthiness check does not narrow a boolean-literal discriminated union.
  For `type R = { ok: true; model: M } | { ok: false; errors: E[] }`:
  - `if (!r.ok) r.errors` → `TS2339: Property 'errors' does not exist on type 'R'`
  - `if (r.ok === false) r.errors` → compiles

Interpreter phase 1 hit this with `CompileResult`. It uses `x.ok === false` at
four sites as a workaround:
- `services/compiler/cache.ts`;
- `services/compiler/report.ts`;
- `transition()` in `resolvers/mutations/import.ts`;
- `scripts/compile-stored-pathways.ts`.

Once the flag is on, those four can go back to the plain `!x.ok` form.

## Size (measured 2026-09-27 on `feat/interpreter-01-compiler`)

`tsc -p apps/pathway-service/tsconfig.json --noEmit --strictNullChecks` reports
**2 errors** in source:

```
services/resolution/multi-pathway-session-store.ts(345,5): TS2322: Type 'EvaluationTemporalContext | undefined' is not assignable to type 'EvaluationTemporalContext'.
services/resolution/session-store.ts(255,5): TS2322: Type 'EvaluationTemporalContext | undefined' is not assignable to type 'EvaluationTemporalContext'.
```

Both come from reading a stored session's temporal context, which older rows may
not have. Decide whether the field is optional on the type, or whether the store
refuses a row that lacks it.

## Caveat: tests are not typechecked

The tsconfig excludes `src/__tests__`, and Jest runs ts-jest with diagnostics
off. Enabling the flag therefore covers source only. Typechecking the tests is
a separate change, and it will surface its own errors.

## Proposed fix

1. Resolve the 2 errors above.
2. Add `"strictNullChecks": true` to `apps/pathway-service/tsconfig.json`
   (or `"strict": true`, after measuring what the other strict flags add).
3. Revert the four `=== false` workarounds to `!x.ok`.
4. Keep `tsc --noEmit` clean.
