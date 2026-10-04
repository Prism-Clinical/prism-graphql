/**
 * Minimal HTTP wrapper around the public RxNav (NLM) APIs.
 *
 * Endpoints used:
 *   - findRxcuiByString — free-text → RxCUI
 *   - getIngredient    — RxCUI → ingredient-level RxCUI (TTY=IN)
 *   - getAtcClasses    — RxCUI → ATC level-5 codes
 *   - getRxcuiByNdc    — NDC code → RxCUI
 *
 * The DDI portion of RxNav was deprecated in Jan 2024 — we deliberately do
 * not use it. The normalization endpoints used here remain stable.
 *
 * Rate limit: ~20 req/sec. The pre-warm pipelines call this serially per
 * drug and pre-warm only happens at import / snapshot ingestion (not at
 * resolution time), so we don't need our own rate limiter.
 */

const RXNAV_BASE = 'https://rxnav.nlm.nih.gov/REST';
const RXNAV_TIMEOUT_MS = 5_000;

export class RxNavError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'RxNavError';
  }
}

async function rxnavFetch(path: string): Promise<unknown> {
  const url = `${RXNAV_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(RXNAV_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new RxNavError(`RxNav ${res.status} for ${path}`, res.status);
  }
  return res.json();
}

/**
 * Look up an RxCUI by free-text drug name. Tries exact match first; returns
 * null if no exact match. Approximate matching is intentionally NOT used here
 * — fuzzy matches lead to wrong-drug normalizations. If exact fails, the drug
 * lands in the unnormalized admin queue for clinician review.
 */
export async function findRxcuiByString(name: string): Promise<string | null> {
  const data = (await rxnavFetch(
    `/rxcui.json?name=${encodeURIComponent(name)}`,
  )) as { idGroup?: { rxnormId?: string[] } };
  const ids = data.idGroup?.rxnormId;
  return ids && ids.length > 0 ? ids[0] : null;
}

/**
 * Resolve any RxCUI to its ingredient-level RxCUI (TTY=IN). Interactions are
 * keyed at the ingredient level — "Toprol XL 50mg" must reduce to the
 * metoprolol ingredient before any pair lookup.
 */
export async function getIngredientRxcui(
  rxcui: string,
): Promise<{ rxcui: string; name: string } | null> {
  const data = (await rxnavFetch(
    `/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=IN`,
  )) as {
    relatedGroup?: {
      conceptGroup?: Array<{
        tty?: string;
        conceptProperties?: Array<{ rxcui: string; name: string }>;
      }>;
    };
  };
  const groups = data.relatedGroup?.conceptGroup ?? [];
  for (const g of groups) {
    if (g.tty !== 'IN') continue;
    const props = g.conceptProperties?.[0];
    if (props) return { rxcui: props.rxcui, name: props.name };
  }
  return null;
}

/**
 * Get ATC level-5 classes for an RxCUI. A drug may belong to multiple ATC
 * classes (e.g. carvedilol is both a beta-blocker and an alpha-blocker).
 * Empty array if RxNav has no ATC classification for this drug.
 */
export async function getAtcClasses(rxcui: string): Promise<string[]> {
  const data = (await rxnavFetch(
    `/rxclass/class/byRxcui.json?rxcui=${encodeURIComponent(rxcui)}&relaSource=ATC`,
  )) as {
    rxclassDrugInfoList?: {
      rxclassDrugInfo?: Array<{
        rxclassMinConceptItem?: { classId?: string };
      }>;
    };
  };
  const items = data.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
  const classes = new Set<string>();
  for (const item of items) {
    const id = item.rxclassMinConceptItem?.classId;
    if (id) classes.add(id);
  }
  return [...classes];
}

/**
 * EVERY ingredient (TTY=IN) of an RxCUI, in RxNav's order. `getIngredientRxcui`
 * returns only the first — right for the drug-safety pair lookup it was written
 * for, wrong for "does this product contain folic acid": a prenatal
 * multivitamin has a dozen ingredients and folic acid is rarely the first.
 */
export async function getIngredients(rxcui: string): Promise<Array<{ rxcui: string; name: string }>> {
  const data = (await rxnavFetch(
    `/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=IN`,
  )) as {
    relatedGroup?: {
      conceptGroup?: Array<{ tty?: string; conceptProperties?: Array<{ rxcui: string; name: string }> }>;
    };
  };
  const out: Array<{ rxcui: string; name: string }> = [];
  for (const g of data.relatedGroup?.conceptGroup ?? []) {
    if (g.tty !== 'IN') continue;
    for (const p of g.conceptProperties ?? []) out.push({ rxcui: p.rxcui, name: p.name });
  }
  return out;
}

/** The term type of an RxCUI (SCD, SBD, BN, IN, GPCK, …), or null when RxNav does not know it. */
export async function getTermType(rxcui: string): Promise<string | null> {
  const data = (await rxnavFetch(`/rxcui/${encodeURIComponent(rxcui)}/properties.json`)) as {
    properties?: { tty?: string };
  };
  return data.properties?.tty ?? null;
}

/** RxNorm term types that are one dispensable PRODUCT, as opposed to an ingredient or a brand. */
const PRODUCT_TERM_TYPES = new Set(['SCD', 'SBD', 'GPCK', 'BPCK']);

/**
 * The PRODUCT-level ATC classes (levels 1–4) of an RxCUI — RxClass's
 * `ATCPROD` relation. Several classes exist only here: an influenza vaccine's
 * ingredients carry no ATC class at all, and a Tdap's ingredients say only
 * "diphtheria" and "tetanus" (the same as plain Td) while the product is
 * J07AJ, pertussis.
 *
 * Asked about an ingredient or a brand, RxClass answers with the classes of
 * EVERY product made from it — ferrous sulfate returns B03AA (oral iron) and
 * B03AE (multivitamins containing iron) alike. That union says nothing about
 * the entry on the chart, so for a non-product concept the classes are kept
 * only when there is exactly ONE (Venofer → B03AC). Otherwise: none, which
 * readers treat as "class unknown", never as "in no class".
 */
export async function getProductAtcClasses(rxcui: string, termType: string | null): Promise<string[]> {
  const data = (await rxnavFetch(
    `/rxclass/class/byRxcui.json?rxcui=${encodeURIComponent(rxcui)}&relaSource=ATCPROD`,
  )) as {
    rxclassDrugInfoList?: { rxclassDrugInfo?: Array<{ rxclassMinConceptItem?: { classId?: string } }> };
  };
  const classes = new Set<string>();
  for (const item of data.rxclassDrugInfoList?.rxclassDrugInfo ?? []) {
    const id = item.rxclassMinConceptItem?.classId;
    if (id) classes.add(id);
  }
  const sorted = [...classes].sort();
  const isProduct = termType !== null && PRODUCT_TERM_TYPES.has(termType);
  return isProduct || sorted.length === 1 ? sorted : [];
}

/** Resolve an NDC (drug package code) to an RxCUI. */
export async function getRxcuiByNdc(ndc: string): Promise<string | null> {
  const data = (await rxnavFetch(
    `/ndcstatus.json?ndc=${encodeURIComponent(ndc)}`,
  )) as { ndcStatus?: { rxcui?: string } };
  const rxcui = data.ndcStatus?.rxcui;
  return rxcui && rxcui !== '' ? rxcui : null;
}
