/**
 * Preview session cleanup — resolver-level tests.
 *
 * deletePreviewSession delegates to the store and translates its result kinds
 * into GraphQL errors (NOT_FOUND / FORBIDDEN). That a preview run is stored
 * with isPreview=true is tested against the real pipeline in
 * pipeline-run-mutations.test.ts; store-level SQL in
 * multi-pathway-session-store-preview.test.ts.
 */

jest.mock('../services/resolution/multi-pathway-session-store', () => ({
  deletePreviewSession: jest.fn(),
}));

import { multiPathwayResolutionMutations } from '../resolvers/mutations/multi-pathway-resolution';
import { deletePreviewSession as mockedStoreDelete } from '../services/resolution/multi-pathway-session-store';

function fakeCtx() {
  return {
    pool: { connect: jest.fn() } as unknown,
    redis: {},
    userId: 'provider-1',
    userRole: 'PROVIDER',
  } as never;
}

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
