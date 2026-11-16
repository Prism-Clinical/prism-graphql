/**
 * EXPERIMENTAL, NONCLINICAL. The raw-execution configuration-error boundary: expected input failures
 * from any stage leave `experimentalExecuteFromRawRecords` as RawExecutionConfigurationError and
 * `experimentalExecutePreviewFromRawRecords` as RawPreviewConfigurationError, with the stage error kept
 * as `cause`. Errors already of the boundary type and unexpected defects propagate as the same object.
 * Core regressions use real malformed context bindings; fault injection only where noted.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as boundModule from '../bound';
import * as evidenceModule from '../s6/evidence';
import {
  EncounterCheckConfigurationError,
  EpisodeCheckConfigurationError,
  experimentalCompile,
  experimentalCompilePreview,
  experimentalExecuteFromRawRecords,
  experimentalExecutePreviewFromRawRecords,
  RawExecutionConfigurationError,
  RawPreviewConfigurationError,
  SelectionConfigurationError,
} from '../index';
import { EXIT, run } from '../try/try-ppl';

const ROOT = join(__dirname, '..', '..');
type Json = { [k: string]: any }; // test documents are untyped JSON
const load = (p: string): Json => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const SCHEMATIC = load('try/programs/schematic.ppl.json');
const MIXED = load('try/programs/schematic-preview.ppl.json');
const ESTABLISHED = load('try/scenarios/established.json');

const node = (p: Json, id: string) => p.nodes.find((n: Json) => n.id === id);
const edited = (p: Json, f: (c: Json) => void) => {
  const c = JSON.parse(JSON.stringify(p));
  f(c);
  return c;
};
/** Two complete queries: the mixed program with q.alt's hole filled by q.demo's own criterion. */
const TWO_COMPLETE = edited(MIXED, (c) => {
  node(c, 'q.alt').contract.establishes = node(c, 'q.demo').contract.establishes;
});
const REFUTES_HOLE = edited(SCHEMATIC, (c) => {
  node(c, 'q.demo').contract.refutes = { hole: { id: 'H-REFUTES', type: 'Decision', explains: 'refutes not decided yet' } };
});
const WHOLE_HOLE = edited(SCHEMATIC, (c) => {
  node(c, 'q.demo').contract = { hole: { id: 'H-C', type: 'EvidenceSelectionContract<Boolean>', explains: 'contract not decided yet' } };
});

const input = (ctx: { episode?: unknown; encounter?: unknown } = {}) =>
  ({
    subject: ESTABLISHED.context.subject,
    revisions: ESTABLISHED.records,
    retractions: ESTABLISHED.retractions,
    contextEncounter: 'encounter' in ctx ? ctx.encounter : ESTABLISHED.context.encounter,
    contextEpisode: 'episode' in ctx ? ctx.episode : ESTABLISHED.context.episode,
    snapshot: { id: ESTABLISHED.snapshot, coverage: ESTABLISHED.coverage, failures: ESTABLISHED.failures, rejectedItems: ESTABLISHED.rejectedItems },
  }) as never;
const compiled = (p: Json) => {
  const c = experimentalCompile(p);
  if (c.outcome !== 'Compiled') throw new Error('expected a compiled package');
  return c.package;
};
const preview = (p: Json) => {
  const c = experimentalCompilePreview(p);
  if (c.outcome !== 'PreviewPackage') throw new Error('expected a preview package');
  return c.package;
};
const thrown = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
};

const MALFORMED = [
  { name: 'episode', ctx: { episode: { known: 5 } }, stage: EpisodeCheckConfigurationError, message: 'malformed evaluation episode {"known":5}' },
  { name: 'encounter', ctx: { encounter: { unknown: [] } }, stage: EncounterCheckConfigurationError, message: 'malformed evaluation encounter {"unknown":[]}' },
] as const;

afterEach(() => jest.restoreAllMocks());

describe('malformed context bindings leave through the entry point own boundary error', () => {
  const normal = [
    ['one query', () => compiled(SCHEMATIC)],
    ['two queries', () => compiled(TWO_COMPLETE)],
  ] as const;
  const previews = [
    ['complete query', () => preview(SCHEMATIC)],
    ['criterion-holed query', () => preview(REFUTES_HOLE)],
    ['mixed program (complete + holed)', () => preview(MIXED)],
  ] as const;

  for (const m of MALFORMED) {
    for (const [what, pkg] of normal) {
      it(`normal, ${what}: malformed ${m.name} → RawExecutionConfigurationError, stage error as cause`, () => {
        const e = thrown(() => experimentalExecuteFromRawRecords(pkg(), input(m.ctx))) as Error;
        expect(e).toBeInstanceOf(RawExecutionConfigurationError);
        expect(e.message).toBe(m.message);
        expect(e.cause).toBeInstanceOf(m.stage);
        expect((e.cause as Error).message).toBe(m.message);
      });
    }
    for (const [what, pkg] of previews) {
      it(`preview, ${what}: malformed ${m.name} → RawPreviewConfigurationError, stage error as cause`, () => {
        const e = thrown(() => experimentalExecutePreviewFromRawRecords(pkg(), input(m.ctx))) as Error;
        expect(e).toBeInstanceOf(RawPreviewConfigurationError);
        expect(e.message).toBe(m.message);
        expect(e.cause).toBeInstanceOf(m.stage);
      });
    }
  }

  it('valid input still evaluates in every one of these shapes', () => {
    expect(experimentalExecuteFromRawRecords(compiled(SCHEMATIC), input()).outputs['f.demo']).toMatchObject({ status: { value: 'True' } });
    expect(experimentalExecuteFromRawRecords(compiled(TWO_COMPLETE), input()).outputs['f.both']).toMatchObject({ status: { value: 'True' } });
    expect(experimentalExecutePreviewFromRawRecords(preview(SCHEMATIC), input()).outputs['f.demo']).toMatchObject({ status: { value: 'True' } });
    expect(experimentalExecutePreviewFromRawRecords(preview(REFUTES_HOLE), input()).outputs['f.demo']).toMatchObject({ status: { marker: { holes: ['H-REFUTES'] } } });
    expect(experimentalExecutePreviewFromRawRecords(preview(MIXED), input()).outputs['f.demo']).toMatchObject({ status: { value: 'True' } });
  });

  it('whole-contract hole: still no stage runs, so a malformed binding is not read (unchanged)', () => {
    const r = experimentalExecutePreviewFromRawRecords(preview(WHOLE_HOLE), input({ episode: { known: 5 } })) as Json;
    expect(r.queryAuthoring).toBe('Incomplete');
    expect(r.previewQuery).toMatchObject({ contract: 'WholeContractHole', stagesRun: [] });
    expect(r.stagesRun).toEqual([]);
  });
});

describe('a multi-query failure fails the whole call (fault injection)', () => {
  it('the second query failing after the first succeeded gives the boundary error and no result', () => {
    const real = boundModule.selectForQuery;
    const stageError = new EpisodeCheckConfigurationError('injected on the second query');
    let calls = 0;
    jest.spyOn(boundModule, 'selectForQuery').mockImplementation((i) => {
      calls += 1;
      if (calls === 2) throw stageError;
      return real(i);
    });
    const ev = jest.spyOn(evidenceModule, 'queryEvidence');
    const e = thrown(() => experimentalExecuteFromRawRecords(compiled(TWO_COMPLETE), input())) as Error;
    expect(calls).toBe(2);
    expect(ev).toHaveBeenCalledTimes(1);
    expect(e).toBeInstanceOf(RawExecutionConfigurationError);
    expect(e.cause).toBe(stageError);
    expect(e.message).toBe('injected on the second query');
  });
});

describe('boundary errors are not wrapped again; defects propagate as the same object', () => {
  it('a boundary error raised by the entry point itself has no cause', () => {
    const extra = { ...(input() as Json), query: 'q.demo' };
    const n = thrown(() => experimentalExecuteFromRawRecords(compiled(SCHEMATIC), extra as never)) as Error;
    expect(n).toBeInstanceOf(RawExecutionConfigurationError);
    expect(n.cause).toBeUndefined();
    const p = thrown(() => experimentalExecutePreviewFromRawRecords(preview(SCHEMATIC), extra as never)) as Error;
    expect(p).toBeInstanceOf(RawPreviewConfigurationError);
    expect(p.cause).toBeUndefined();
  });

  it('a boundary error raised inside the query loop propagates unchanged (fault injection)', () => {
    const n = new RawExecutionConfigurationError('already at the boundary');
    jest.spyOn(boundModule, 'selectForQuery').mockImplementation(() => {
      throw n;
    });
    expect(thrown(() => experimentalExecuteFromRawRecords(compiled(SCHEMATIC), input()))).toBe(n);
    const p = new RawPreviewConfigurationError('already at the boundary');
    jest.spyOn(boundModule, 'selectForPreviewCompleteQuery').mockImplementation(() => {
      throw p;
    });
    expect(thrown(() => experimentalExecutePreviewFromRawRecords(preview(SCHEMATIC), input()))).toBe(p);
  });

  // A stage configuration error that only engine-built input could cause (here S4's) is a defect, not caller input.
  for (const [what, make] of [
    ['a plain Error', () => new Error('engine defect')],
    ['an engine-internal stage configuration error', () => new SelectionConfigurationError('engine-built S3 rejected')],
  ] as const) {
    it(`${what} propagates as the same object from both entry points (fault injection)`, () => {
      const err = make();
      jest.spyOn(evidenceModule, 'queryEvidence').mockImplementation(() => {
        throw err;
      });
      expect(thrown(() => experimentalExecuteFromRawRecords(compiled(SCHEMATIC), input()))).toBe(err);
      expect(thrown(() => experimentalExecutePreviewFromRawRecords(preview(SCHEMATIC), input()))).toBe(err);
    });
  }
});

describe('try:ppl maps only the two boundary errors to exit 3', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raw-config-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const scenarioWith = (ctx: Json) => {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ ...ESTABLISHED, context: { ...ESTABLISHED.context, ...ctx } }));
    return p;
  };

  it('normal → RawExecutionConfigurationError, preview → RawPreviewConfigurationError, exit 3', () => {
    const file = scenarioWith({ episode: { known: 5 } });
    const n = run(['--program', 'try/programs/schematic.ppl.json', '--scenario', file], ROOT);
    expect(n.code).toBe(EXIT.configuration);
    expect(n.stdout).toBe('');
    expect(n.stderr).toBe('configuration error (RawExecutionConfigurationError: the engine rejected this input; no evaluation happened): malformed evaluation episode {"known":5}\n');
    const p = run(['--program', 'try/programs/schematic-preview.ppl.json', '--scenario', file, '--preview'], ROOT);
    expect(p.code).toBe(EXIT.configuration);
    expect(p.stderr).toMatch(/^configuration error \(RawPreviewConfigurationError: .*malformed evaluation episode/);
  });

  it('any other error, a stage configuration error included, is not exit 3: run() rethrows it (main exits 70)', () => {
    for (const err of [new Error('engine defect'), new SelectionConfigurationError('engine-built S3 rejected')]) {
      jest.spyOn(evidenceModule, 'queryEvidence').mockImplementation(() => {
        throw err;
      });
      expect(thrown(() => run(['--program', 'try/programs/schematic.ppl.json', '--scenario', 'try/scenarios/established.json'], ROOT))).toBe(err);
      jest.restoreAllMocks();
    }
  });
});
