/**
 * EXPERIMENTAL, NONCLINICAL. One S3 admissibility check: same-episode scope (contract §2.2, §2.5).
 * Not the S3 result.
 *
 * Pure: no I/O, no clock, no input mutation. Runs S2 on the supplied S1 (one snapshot) and reads
 * the payloads S1 retained. Episode membership is never inferred from dates, encounters or
 * proximity: only the record's own `episode` field is compared. The result is detached and
 * deep-frozen.
 */
import { detach } from '../compile/compile';
import { canonicalJson } from '../s1/payload';
import type { JsonObject } from '../s1/resolve';
import { CONTEXT_CAUSES, checkScopeInput, scopeKeys } from './scope';
import {
  SAME_EPISODE_RULE,
  type EpisodeBinding,
  type EpisodeCheckInput,
  type EpisodeCheckResult,
  type EpisodeFinding,
  type EpisodeOutcome,
  type PossibleEpisodeScope,
} from './types';

/** Invalid program, rule or configuration input. Never used for patient-evidence problems. */
export class EpisodeCheckConfigurationError extends Error {}

const RULE = canonicalJson(SAME_EPISODE_RULE as never);
const INPUT_FIELDS = ['s1', 'valueSet', 'expansion', 'rule', 'contextEpisode'];
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/**
 * EpisodeRef syntax (contract §2.5), defined for episodes on their own: a string with at least one
 * character outside Unicode White_Space. Never trimmed or otherwise normalized.
 */
const episodeRef = (v: unknown): v is string => typeof v === 'string' && /\P{White_Space}/u.test(v);

function checkContext(b: EpisodeBinding): void {
  const fail = (): never => {
    throw new EpisodeCheckConfigurationError(`malformed evaluation episode ${JSON.stringify(b)}`);
  };
  if (b === null || typeof b !== 'object' || Object.keys(b).length !== 1) fail();
  if (own(b, 'known')) {
    if (!episodeRef((b as { known: unknown }).known)) fail();
  } else if (own(b, 'unknown')) {
    const cs: unknown = (b as { unknown: unknown }).unknown;
    if (!Array.isArray(cs)) return fail();
    const all = [...cs]; // a sparse hole becomes `undefined`, which is rejected
    if (all.length === 0 || new Set(all).size !== all.length || !all.every((c) => CONTEXT_CAUSES.includes(c))) fail();
  } else fail();
}

/** Contract §2.5 `episode` rule for one record payload. Record and context findings accumulate. */
function compare(payload: JsonObject, ctx: EpisodeBinding): EpisodeOutcome {
  const findings: EpisodeFinding[] = [];
  const value = own(payload, 'episode') ? payload['episode'] : undefined;
  if (value === undefined) findings.push({ cause: 'Missing', origin: 'record', reason: 'FieldAbsent:episode' });
  else if (!episodeRef(value)) findings.push({ cause: 'Invalid', origin: 'record', reason: 'FieldMalformed:episode' });
  if ('unknown' in ctx) {
    for (const cause of CONTEXT_CAUSES) {
      if (ctx.unknown.includes(cause)) findings.push({ cause, origin: 'context.episode', reason: 'ContextUnknown:episode' });
    }
  }
  if (findings.length > 0 || !episodeRef(value) || !('known' in ctx)) return { outcome: 'Unresolved', findings };
  // Identity is exact string equality: no normalization, and no other field is consulted.
  return value === ctx.known
    ? { outcome: 'Matches', recordEpisode: value }
    : { outcome: 'DoesNotMatch', reason: 'OtherEpisode', recordEpisode: value, contextEpisode: ctx.known };
}

export function checkEpisodeScope(input: EpisodeCheckInput): EpisodeCheckResult {
  checkScopeInput(input, INPUT_FIELDS, input?.rule, RULE, (m) => {
    throw new EpisodeCheckConfigurationError(m);
  });
  const { s1, valueSet, expansion, contextEpisode } = input;
  checkContext(contextEpisode);
  const { valueSet: pin, keys } = scopeKeys(s1, valueSet, expansion, (p, payload): PossibleEpisodeScope =>
    p.candidacy === 'OutOfDomain'
      ? { kind: 'node', node: p.node, candidacy: 'OutOfDomain', episode: { outcome: 'NotEvaluated', reason: 'OutOfDomain' } }
      : { kind: 'node', node: p.node, candidacy: p.candidacy, s2Findings: p.candidacy === 'Unresolved' ? p.findings : [], episode: compare(payload, contextEpisode) },
  );
  return detach({ experimental: 'nonclinical-s3-episode-v0', check: 'same-episode', valueSet: pin, contextEpisode, keys });
}
