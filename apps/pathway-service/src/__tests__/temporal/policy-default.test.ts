import { DEFAULT_TEMPORAL_POLICY_VERSION } from '../../services/resolution/temporal/evaluation-context';
import { resolveTemporalPolicyVersion } from '../../resolvers/helpers/resolution-context';
import { policyCapabilities } from '../../services/resolution/temporal/policy-registry';
import type { DataSourceContext } from '../../types';

describe('default temporal policy version', () => {
  // Assert the CAPABILITY, not just the string. `legacy-v0` routes to
  // evaluationMode 'legacy', which never computes indeterminate — the signal
  // the escalation semantics are built on. A future rename of the version
  // string must not silently put the default back on the legacy evaluator.
  it('resolves to a kernel-mode policy when the deployment injects nothing', () => {
    const version = resolveTemporalPolicyVersion({} as DataSourceContext);
    expect(policyCapabilities(version).evaluationMode).toBe('kernel');
  });

  it('is v1', () => {
    expect(DEFAULT_TEMPORAL_POLICY_VERSION).toBe('v1');
  });

  // Deployment config must still win, so a session can be pinned to
  // legacy-v0 for differential testing.
  it('still lets an injected version override the default', () => {
    const version = resolveTemporalPolicyVersion(
      { temporalPolicyVersion: 'legacy-v0' } as DataSourceContext,
    );
    expect(version).toBe('legacy-v0');
    expect(policyCapabilities(version).evaluationMode).toBe('legacy');
  });
});
