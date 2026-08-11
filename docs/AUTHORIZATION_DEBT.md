# Authorization Debt

Tracked gaps where an API surface *names* a privilege it does not enforce.

Each entry states what is unenforced, why it is unenforced right now, and the
exact change to make once authentication exists. These are deliberate, recorded
decisions — not oversights — and none of them should be closed by adding a check
against a caller-asserted header.

---

## AD-1 — `x-user-role` is caller-asserted and nothing derives it from a token

**Status:** open. Blocks AD-2.

`pathway-service` builds its GraphQL context by reading two request headers
directly, with permissive defaults (`apps/pathway-service/src/index.ts`):

```ts
const userId   = req.headers['x-user-id']   as string || DEV_PROVIDER_ID;
const userRole = req.headers['x-user-role'] as string || 'PROVIDER';
```

Any caller can send `x-user-role: ADMIN`. Nothing verifies it, and nothing
derives it from a bearer token.

There *is* a bearer token in the platform, but not on this path:

| Client | Sends | Read by pathway-service? |
|---|---|---|
| `prism-provider-front-end` | `authorization: Bearer <token>` (`src/lib/apollo-client.ts`) | **No** — the service never inspects `authorization` |
| `prism-admin-dashboard` | no auth header at all (`src/lib/apollo-client.ts` link chain is `removeTypenameFromVariables → errorLink → httpLink`) | n/a |

So the admin dashboard — the client that actually drives pathway authoring and
simulation — arrives as the `PROVIDER` default on every request.

**Fix:** verify the bearer token at the subgraph (or have the gateway inject
verified claims), and derive `userId`/`userRole` from those claims rather than
from client-supplied headers. Until then, any role check in this service is
decorative.

### Consequence already recorded in code

`assertSyntheticAuthorized` (`services/resolution/temporal/trust-mode.ts`)
performs a real ADMIN check and is documented in place as **defence in depth,
not access control**, for exactly this reason. Do not cite it as securing
anything.

---

## AD-2 — `includeDraftPathways` and `syntheticPatient` are unenforced QA capabilities

**Status:** open, blocked on AD-1. **Deliberately not enforced on this branch.**

`Mutation.startMultiPathwayResolution` accepts two flags that grant QA/preview
capability:

- `includeDraftPathways` — also match DRAFT (unpublished) pathways.
- `syntheticPatient` — drive matching from the caller's own condition codes
  instead of the EMR-synced snapshot tables.

Both were documented as "Admin-only QA flag" in the SDL while enforcing nothing.
The SDL now says what is true: a QA/preview capability that is **not
access-controlled**.

### Why enforcement was not added

Raised in review as a P1 with the recommendation to require explicit
`SYNTHETIC` + ADMIN. That recommendation was withdrawn after checking the
callers. Adding the check today would:

1. **Break the only deployed admin UI.** `PatientComposer.tsx` and
   `PreviewResolutionPanel.tsx` both send `includeDraftPathways: true` and
   `syntheticPatient: true`, over a client that sends no role header (AD-1), so
   every such request would start failing.
2. **Secure nothing**, because the role it checks is caller-asserted (AD-1).

Breaking the live encounter simulator for a check that any client can satisfy by
sending one header is the wrong trade.

### What WAS fixed

The load-bearing half of the finding — that raw caller data influenced matching
*before* validation — is fixed on this branch. `parseResolutionInput` now runs
first, and `directPatientCodes` is derived from the validated
`resolutionInput.patientContext`, so every code reaching the matcher has passed
the same trust boundary as the codes reaching the evaluator.

### Fix, when AD-1 lands

1. Gate both flags on **verified** claims, not `context.userRole` as read today.
2. Keep `syntheticPatient` incompatible with `LIVE` and `REPLAY`. This is
   already enforced in `startMultiPathwayResolution` — a caller-supplied code
   set has no meaning once facts come from a snapshot or a recorded session —
   and the guard must survive the authorization change rather than being folded
   into it.
3. Decide whether `includeDraftPathways` should additionally be environment-
   gated (off in production regardless of role).

---

## Related

- `docs/superpowers/specs/2026-07-21-pathway-temporal-horizon-design.md` §8 —
  trust modes and the resolution input contract.
- `docs/superpowers/plans/2026-07-26-temporal-horizon-05-context-assembler.md`
  decision 8 — the same "defence in depth, not a security boundary" framing,
  recorded when the SYNTHETIC check was written.
