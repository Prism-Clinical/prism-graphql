/**
 * EXPERIMENTAL, NONCLINICAL. Public types of the first PPL compiler subset (I1).
 *
 * Normative source: docs/superpowers/records/pathway-language/first-program-implementation-contract.md
 * §2 (declarations, forms, context), §5 (diagnostics), §6 (compile-time checks) and §7 (preview).
 * Compilation confers no clinical approval. No evaluation happens here.
 */
import type { JsonValue } from '../s1/types';
import type { ValueSetExpansion } from '../s2/types';

export type DiagnosticCode =
  | 'SOURCE_INVALID'
  | 'UNKNOWN_EXECUTABLE_PROPERTY'
  | 'INVALID_DECLARATION_ID'
  | 'UNDEFINED_REFERENCE'
  | 'TYPE_MISMATCH'
  | 'UNSUPPORTED_CONTEXT_REFERENCE'
  | 'UNSUPPORTED_CONSTRUCT'
  | 'CYCLIC_EXECUTION_DEPENDENCY'
  | 'EXCLUSIVE_BRANCH_OVERLAP'
  | 'UNSUPPORTED_PROOF_FRAGMENT'
  | 'UNRESOLVED_AUTHORING_HOLE';

/** Machine comparison uses `code`, `location` (RFC 6901 pointer into the source) and `hole`; `message` is prose. */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly location: string;
  readonly hole?: string;
  readonly message: string;
}

export type ValueType = 'Decision' | 'Evidence<Boolean>';

/** A validated program-position expression (contract §2). `location` is its JSON Pointer. */
export type Expr =
  | { readonly form: 'ref'; readonly target: string; readonly location: string }
  | { readonly form: 'evidenceValue'; readonly arg: Expr; readonly location: string }
  | { readonly form: 'all'; readonly args: readonly Expr[]; readonly location: string }
  | { readonly form: 'hole'; readonly hole: string; readonly location: string };

export interface HoleInfo {
  readonly id: string;
  /** The declared type, equal to its position's type. */
  readonly type: 'Decision' | 'EvidenceSelectionContract<Boolean>' | 'UrgencyRequirement';
  /** Records what is undecided; never executable meaning. */
  readonly explains: string;
  readonly cites: readonly string[];
  /** Pointer to the `hole` member. */
  readonly location: string;
}

/** `eq(c.<field>, <Enum>.<value>)` over one candidate (contract §3.1). */
export interface EnumCriterion {
  readonly field: string;
  readonly enumType: string;
  readonly value: string;
  readonly location: string;
}

/** A validated explicit-assertion-v0 contract. `source` is a frozen copy of the authored contract. */
export interface ExplicitAssertionContract {
  readonly kind: 'explicit-assertion-v0';
  readonly recordType: string;
  readonly sources: readonly string[];
  readonly valueSet: string;
  readonly authorityRule: string;
  /** The recognized admissible rules, verbatim (episode and encounter: eq(c.f, ctx.f)). */
  readonly admissible: { readonly episode: JsonValue; readonly encounter: JsonValue; readonly assertionKinds: readonly string[] };
  readonly establishes: EnumCriterion;
  readonly refutes: EnumCriterion;
  readonly source: JsonValue;
  readonly location: string;
}

export type CompiledDeclaration =
  | {
      readonly kind: 'Predicate';
      readonly id: string;
      /** True for the program's required top-level applicability. */
      readonly applicability: boolean;
      readonly expr: Expr;
      readonly cites: readonly string[];
      readonly location: string;
    }
  | {
      readonly kind: 'EvidenceQuery';
      readonly id: string;
      readonly subject: 'patient';
      readonly output: 'Evidence<Boolean>';
      readonly contract: ExplicitAssertionContract | { readonly kind: 'hole'; readonly hole: string; readonly location: string };
      readonly cites: readonly string[];
      readonly location: string;
    }
  | {
      readonly kind: 'Finding';
      readonly id: string;
      readonly status: Expr;
      readonly label: string;
      readonly heading: string | null;
      readonly urgency: { readonly hole: string; readonly location: string } | null;
      readonly cites: readonly string[];
      readonly location: string;
    };

export interface CompiledReference {
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
  readonly lines: readonly [number, number];
  readonly quote: { readonly [line: string]: string };
  readonly location: string;
}

/** reader → read, derived from authored references; `locations` are every authoring `ref` pointer. */
export interface DependencyEdge {
  readonly reader: string;
  readonly read: string;
  readonly locations: readonly string[];
}

export interface PreviewMarker {
  /** `<id>` for applicability, Predicate and EvidenceQuery; `<id>.status` / `<id>.<attribute>` for a Finding. */
  readonly output: string;
  readonly holes: readonly string[];
}

/** Content shared by both package kinds. Declarations are in a deterministic topological order. */
export interface CompiledProgram {
  readonly packageId: string;
  readonly languageVersion: 'ppl-1';
  readonly capabilityProfileVersion: 'ppl-core-v0';
  readonly applicabilityId: string;
  readonly declarations: readonly CompiledDeclaration[];
  readonly references: readonly CompiledReference[];
  readonly valueSets: { readonly [id: string]: ValueSetExpansion };
  readonly dependencyEdges: readonly DependencyEdge[];
  readonly holes: readonly HoleInfo[];
}

/** A complete program. Only this kind may later be evaluated ordinarily. No clinical approval implied. */
export interface CompiledPackage extends CompiledProgram {
  readonly kind: 'CompiledPackage';
  readonly experimental: 'nonclinical-ppl-compile-v0';
}

/** A well-formed program accepted with its holes. Never publishable or clinically executable. */
export interface PreviewPackage extends CompiledProgram {
  readonly kind: 'PreviewPackage';
  readonly experimental: 'nonclinical-ppl-compile-v0';
  readonly publication: 'Blocked';
  readonly markers: readonly PreviewMarker[];
  /** Static Finding attributes that stay inspectable: `<id>.label`, `<id>.heading`, `<id>.cites`. */
  readonly inspectable: { readonly [output: string]: JsonValue };
}

export type CompileFailure = {
  readonly outcome: 'CompileFailure';
  /** True only when every diagnostic is UNRESOLVED_AUTHORING_HOLE (normal compilation of a holed program). */
  readonly wellFormed: boolean;
  readonly diagnostics: readonly Diagnostic[];
  /** Present when well-formed. */
  readonly dependencyEdges?: readonly DependencyEdge[];
};

export type CompileResult =
  | { readonly outcome: 'Compiled'; readonly wellFormed: true; readonly diagnostics: readonly []; readonly package: CompiledPackage }
  | CompileFailure;

export type PreviewCompileResult =
  | { readonly outcome: 'PreviewPackage'; readonly wellFormed: true; readonly diagnostics: readonly []; readonly package: PreviewPackage }
  | CompileFailure;
