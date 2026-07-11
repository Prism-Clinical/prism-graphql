/**
 * Preview session isolation — resolver-level tests for slice A.
 *
 * Verifies the mutation-orchestration surface:
 *   - startMultiPathwayResolution threads `syntheticPatient` → `isPreview`
 *     when persisting the session
 *   - deletePreviewSession delegates to the store and translates result
 *     kinds into the right GraphQL errors (NOT_FOUND / FORBIDDEN)
 *
 * Store-level SQL / transaction shape lives in the sibling
 * `multi-pathway-session-store-preview.test.ts` — separate file because
 * `jest.mock` on the store module would otherwise erase the real functions
 * we want to test.
 */

jest.mock('../services/resolution/session-store', () => ({
  getMatchedPathways: jest.fn(),
  createSession: jest.fn(),
}));

jest.mock('../services/resolution/multi-pathway-session-store', () => ({
  createMultiPathwaySession: jest.fn(),
  getMultiPathwaySession: jest.fn(),
  getPatientMultiPathwaySessions: jest.fn(),
  markMultiPathwaySessionStatus: jest.fn(),
  updateMergedPlanAndResolutions: jest.fn(),
  deletePreviewSession: jest.fn(),
}));

import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import {
  createMultiPathwaySession as storeCreate,
  getMultiPathwaySession,
  deletePreviewSession as mockedStoreDelete,
} from '../services/resolution/multi-pathway-session-store';
import { getMatchedPathways } from '../services/resolution/session-store';

function fakeCtx() {
  return {
    pool: { connect: jest.fn() } as unknown,
    redis: {},
    userId: 'provider-1',
    userRole: 'PROVIDER',
  } as never;
}

function fakeSessionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sess-1',
    patientId: 'pt-1',
    providerId: 'provider-1',
    status: 'ACTIVE',
    isPreview: false,
    initialPatientContext: {},
    contributingSessionIds: [],
    contributingPathwayIds: [],
    mergedPlan: {
      sourcePathwayIds: [],
      medications: [],
      labs: [],
      imaging: [],
      procedures: [],
      guidance: [],
      schedules: [],
      qualityMetrics: [],
      suppressed: [],
      conflicts: [],
      catchUpItems: [],
    },
    conflictResolutions: {},
    carePlanId: null,
    ddiWarnings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('startMultiPathwayResolution: syntheticPatient → isPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Short-circuit the empty-match path so we never touch the traversal
    // stack — the isPreview routing lives before that branch.
    (getMatchedPathways as jest.Mock).mockResolvedValue([]);
    (storeCreate as jest.Mock).mockResolvedValue('sess-1');
    (getMultiPathwaySession as jest.Mock).mockResolvedValue(
      fakeSessionRow({ isPreview: false }),
    );
  });

  it('persists isPreview=true when syntheticPatient is true', async () => {
    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      undefined,
      {
        patientId: 'pt-1',
        patientContext: { patientId: 'pt-1', conditionCodes: [{ code: 'E11', system: 'ICD-10' }] },
        syntheticPatient: true,
      },
      fakeCtx(),
    );
    expect(storeCreate).toHaveBeenCalledTimes(1);
    const args = (storeCreate as jest.Mock).mock.calls[0][1];
    expect(args.isPreview).toBe(true);
  });

  it('persists isPreview=false when syntheticPatient is omitted', async () => {
    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      undefined,
      { patientId: 'pt-1' },
      fakeCtx(),
    );
    const args = (storeCreate as jest.Mock).mock.calls[0][1];
    expect(args.isPreview).toBe(false);
  });

  it('persists isPreview=false when syntheticPatient=false is explicit', async () => {
    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      undefined,
      { patientId: 'pt-1', syntheticPatient: false },
      fakeCtx(),
    );
    const args = (storeCreate as jest.Mock).mock.calls[0][1];
    expect(args.isPreview).toBe(false);
  });

  it('surfaces isPreview on the formatted session so the FE can read it', async () => {
    (getMultiPathwaySession as jest.Mock).mockResolvedValueOnce(
      fakeSessionRow({ isPreview: true }),
    );
    const result = await multiPathwayResolutionMutations.startMultiPathwayResolution(
      undefined,
      { patientId: 'pt-1', syntheticPatient: true },
      fakeCtx(),
    );
    expect((result as { isPreview: boolean }).isPreview).toBe(true);
  });
});

describe('deletePreviewSession mutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the sessionId + cascade count on success', async () => {
    (mockedStoreDelete as jest.Mock).mockResolvedValueOnce({
      kind: 'deleted',
      contributingSessionsDeleted: 2,
    });
    const result = await multiPathwayResolutionMutations.deletePreviewSession(
      undefined,
      { sessionId: 'sess-preview' },
      fakeCtx(),
    );
    expect(result).toEqual({
      sessionId: 'sess-preview',
      contributingSessionsDeleted: 2,
    });
  });

  it('throws NOT_FOUND when the session id is unknown', async () => {
    (mockedStoreDelete as jest.Mock).mockResolvedValueOnce({ kind: 'not-found' });
    await expect(
      multiPathwayResolutionMutations.deletePreviewSession(
        undefined,
        { sessionId: 'nope' },
        fakeCtx(),
      ),
    ).rejects.toMatchObject({
      extensions: { code: 'NOT_FOUND' },
    });
  });

  it('throws FORBIDDEN when the row exists but is not a preview session', async () => {
    // Safety net: even if a client somehow gets hold of a real session id,
    // the mutation must refuse to hard-delete. Real sessions are audit-
    // preserved via abandonMultiPathwaySession.
    (mockedStoreDelete as jest.Mock).mockResolvedValueOnce({ kind: 'not-preview' });
    await expect(
      multiPathwayResolutionMutations.deletePreviewSession(
        undefined,
        { sessionId: 'sess-real' },
        fakeCtx(),
      ),
    ).rejects.toMatchObject({
      extensions: { code: 'FORBIDDEN' },
    });
  });
});
