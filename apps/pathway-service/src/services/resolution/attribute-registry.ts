import type { PatientContext } from '../confidence/types';
import { AttributeCodeMap } from './types';

export interface AttributeResolution {
  value: number | string | boolean | undefined;
  fieldsRead: string[];
}

/** Walk a dotted path into a JSON bag, returning a finite number or undefined. */
function numericPath(bag: Record<string, unknown> | undefined, path: string): number | undefined {
  if (!bag) return undefined;
  let cursor: unknown = bag;
  for (const seg of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : undefined;
}

type NamespaceResolver = (
  ctx: PatientContext,
  rest: string,
  fullName: string,
  codeMap: AttributeCodeMap,
) => number | string | boolean | undefined;

export const VALID_ATTRIBUTE_NAMESPACES = ['lab', 'vitals', 'allergy', 'patient'] as const;
export type AttributeNamespace = (typeof VALID_ATTRIBUTE_NAMESPACES)[number];

const RESOLVERS: Record<AttributeNamespace, NamespaceResolver> = {
  lab: (ctx, _rest, fullName, codeMap) => {
    const entry = codeMap.get(fullName);
    if (!entry) return undefined;
    const lab = ctx.labResults.find(
      (l) => l.code === entry.code && (!entry.system || l.system === entry.system),
    );
    return lab?.value;
  },
  vitals: (ctx, rest) => numericPath(ctx.vitalSigns, rest),
  allergy: (ctx, _rest, fullName, codeMap) => {
    const entry = codeMap.get(fullName);
    if (!entry) return undefined;
    return ctx.allergies.some(
      (a) => a.code === entry.code && (!entry.system || a.system === entry.system),
    );
  },
  patient: (ctx, rest) => ctx.patientAttributes?.[rest],
};

export function resolveAttribute(
  ctx: PatientContext,
  attribute: string,
  codeMap: AttributeCodeMap,
): AttributeResolution {
  const dot = attribute.indexOf('.');
  const namespace = dot === -1 ? attribute : attribute.slice(0, dot);
  const rest = dot === -1 ? '' : attribute.slice(dot + 1);
  const resolver = (RESOLVERS as Record<string, NamespaceResolver | undefined>)[namespace];
  const value = resolver ? resolver(ctx, rest, attribute, codeMap) : undefined;
  return { value, fieldsRead: [attribute] };
}
