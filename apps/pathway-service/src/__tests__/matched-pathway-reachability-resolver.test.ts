import { Query } from '../resolvers/Query';
import { ReachabilityScore } from '../services/resolution/reachability';
import { PatientContext } from '../services/confidence/types';

jest.mock('../services/resolution/session-store', () => ({
  getMatchedPathways: jest.fn(),
  getSession: jest.fn(),
  getPatientSessions: jest.fn(),
}));

jest.mock('../services/resolution/snapshot-context', () => ({
  createPatientContextLoader: jest.fn(),
}));

jest.mock('../services/resolution/reachability-loader', () => ({
  computePathwayReachability: jest.fn(),
}));

import { getMatchedPathways } from '../services/resolution/session-store';
import { createPatientContextLoader } from '../services/resolution/snapshot-context';
import { computePathwayReachability } from '../services/resolution/reachability-loader';

function createMockContext() {
  return {
    pool: { query: jest.fn() } as unknown,
    redis: {},
    userId: 'test-user',
    userRole: 'PROVIDER',
  };
}

function makeRow(id: string) {
  return {
    pathway: {
      id,
      logicalId: `lp-${id}`,
      title: `Pathway ${id}`,
      version: '1.0',
      category: 'CHRONIC_DISEASE',
      status: 'ACTIVE',
      conditionCodes: ['I10'],
    },
    matchedConditionCodes: ['I10'],
    matchScore: 1.0,
  };
}

const SAMPLE_PATIENT: PatientContext = {
  patientId: 'p1',
  conditionCodes: [{ code: 'I10', system: 'ICD-10' }],
  medications: [],
  labResults: [],
  allergies: [],
};

const NONZERO_SCORE: ReachabilityScore = {
  totalGates: 3,
  alwaysEvaluableGates: 2,
  dataDependentGates: 1,
  dataAvailableGates: 1,
  questionGates: 0,
  indeterminateGates: 0,
  autoResolvableScore: 1.0,
};

describe('matchedPathways resolver — reachability wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches a per-request __ctx with a memoized loader to each row', async () => {
    const loaderFn = jest.fn().mockResolvedValue(SAMPLE_PATIENT);
    (createPatientContextLoader as jest.Mock).mockReturnValue(loaderFn);
    (getMatchedPathways as jest.Mock).mockResolvedValue([makeRow('a'), makeRow('b')]);

    const ctx = createMockContext();
    const result = await Query.Query.matchedPathways({}, { patientId: 'p1' }, ctx as any);

    expect(result).toHaveLength(2);
    expect(result[0].__ctx).toBeDefined();
    expect(result[1].__ctx).toBeDefined();
    // Both rows must reference the SAME loader instance — that's what makes it
    // memoized across rows in a single request.
    expect(result[0].__ctx.loadPatientContext).toBe(result[1].__ctx.loadPatientContext);
    expect(createPatientContextLoader).toHaveBeenCalledWith(ctx.pool, 'p1');
    expect(createPatientContextLoader).toHaveBeenCalledTimes(1);
  });

  it('reachability field resolver loads patient context and delegates to computePathwayReachability', async () => {
    const loaderFn = jest.fn().mockResolvedValue(SAMPLE_PATIENT);
    (computePathwayReachability as jest.Mock).mockResolvedValue(NONZERO_SCORE);

    const parent = {
      ...makeRow('pathway-x'),
      __ctx: {
        patientId: 'p1',
        loadPatientContext: loaderFn,
      },
    };
    const ctx = createMockContext();

    const result = await (Query as any).MatchedPathway.reachability(parent, {}, ctx);

    expect(loaderFn).toHaveBeenCalledTimes(1);
    expect(computePathwayReachability).toHaveBeenCalledWith(ctx.pool, 'pathway-x', SAMPLE_PATIENT);
    expect(result).toEqual(NONZERO_SCORE);
  });

  it('reachability returns empty score when parent lacks __ctx (defensive fallback)', async () => {
    const parent = makeRow('pathway-y'); // no __ctx
    const ctx = createMockContext();

    const result = await (Query as any).MatchedPathway.reachability(parent, {}, ctx);

    expect(result.totalGates).toBe(0);
    expect(result.autoResolvableScore).toBeNull();
    expect(computePathwayReachability).not.toHaveBeenCalled();
  });

  it('multiple reachability calls within a request share one patient-context load', async () => {
    const loaderFn = jest.fn().mockResolvedValue(SAMPLE_PATIENT);
    (createPatientContextLoader as jest.Mock).mockImplementation(() => {
      // Simulate the real memoization: only call the underlying loader once.
      let cached: Promise<PatientContext> | null = null;
      return () => {
        if (!cached) cached = loaderFn();
        return cached;
      };
    });
    (computePathwayReachability as jest.Mock).mockResolvedValue(NONZERO_SCORE);
    (getMatchedPathways as jest.Mock).mockResolvedValue([makeRow('a'), makeRow('b'), makeRow('c')]);

    const ctx = createMockContext();
    const rows = await Query.Query.matchedPathways({}, { patientId: 'p1' }, ctx as any);

    await Promise.all(
      rows.map((row) =>
        (Query as any).MatchedPathway.reachability(row, {}, ctx),
      ),
    );

    expect(loaderFn).toHaveBeenCalledTimes(1);
    expect(computePathwayReachability).toHaveBeenCalledTimes(3);
  });
});
