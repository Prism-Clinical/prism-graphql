'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_SIGNAL_DEFINITIONS, GET_EFFECTIVE_WEIGHTS, GET_EFFECTIVE_THRESHOLDS, GET_ADMIN_EVIDENCE } from '@/lib/graphql/queries/pathways';
import { SET_SIGNAL_WEIGHT, SET_RESOLUTION_THRESHOLDS, ADD_ADMIN_EVIDENCE, REMOVE_ADMIN_EVIDENCE } from '@/lib/graphql/mutations/pathways';
import type { SignalDefinitionInfo, EffectiveWeightEntry, ResolvedThresholds, AdminEvidenceEntry, PathwayGraphNode, PathwayGraphEdge } from '@/types';

interface TunePhaseProps {
  pathwayId: string;
  nodes: PathwayGraphNode[];
  edges: PathwayGraphEdge[];
}

const SIGNAL_DISPLAY_NAMES: Record<string, string> = {
  data_completeness: 'Data Completeness',
  evidence_strength: 'Evidence Strength',
  match_quality: 'Match Quality',
  risk_magnitude: 'Risk Magnitude',
};

const EVIDENCE_LEVELS = ['Level A', 'Level B', 'Level C', 'Expert Consensus'] as const;

export default function TunePhase({ pathwayId, nodes, edges }: TunePhaseProps) {
  return (
    <div className="enc-phase-content">
      <div className="enc-phase-heading">
        <div>
          <h1 className="enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
            <em>Tune</em> Weights &amp; Evidence
          </h1>
          <p className="enc-subtitle" style={{ fontFamily: 'var(--font-manrope)' }}>
            Adjust signal weights, resolution thresholds, and manage evidence entries.
          </p>
        </div>
      </div>

      <div className="enc-assess-cards">
        <SignalWeightsCard pathwayId={pathwayId} />
        <ThresholdsCard pathwayId={pathwayId} />
        <EvidenceCard pathwayId={pathwayId} nodes={nodes} edges={edges} />
      </div>
    </div>
  );
}

// ─── Signal Weights Card ─────────────────────────────────────────────

function SignalWeightsCard({ pathwayId }: { pathwayId: string }) {
  const { data: signalData, loading: loadingSignals } = useQuery<{
    signalDefinitions: SignalDefinitionInfo[];
  }>(GET_SIGNAL_DEFINITIONS, { variables: { scope: 'SYSTEM' } });

  const { data: weightsData, loading: loadingWeights } = useQuery<{
    effectiveWeights: { entries: EffectiveWeightEntry[] };
  }>(GET_EFFECTIVE_WEIGHTS, { variables: { pathwayId }, fetchPolicy: 'network-only' });

  const loading = loadingSignals || loadingWeights;

  const [setSignalWeight] = useMutation(SET_SIGNAL_WEIGHT);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [savingSignals, setSavingSignals] = useState<Set<string>>(new Set());
  const [savedSignals, setSavedSignals] = useState<Set<string>>(new Set());
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Track which signals the user has locally modified — these should NOT be
  // overwritten when Apollo re-delivers query data.
  const userModified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (signalData?.signalDefinitions) {
      const effectiveByName = new Map<string, number>();
      if (weightsData?.effectiveWeights?.entries) {
        for (const e of weightsData.effectiveWeights.entries) {
          effectiveByName.set(e.signalName, e.weight);
        }
      }

      setWeights(prev => {
        const w: Record<string, number> = { ...prev };
        for (const s of signalData.signalDefinitions) {
          // Skip signals the user has already adjusted in this session
          if (userModified.current.has(s.id)) continue;
          w[s.id] = effectiveByName.get(s.name) ?? s.defaultWeight;
        }
        return w;
      });
    }
  }, [signalData, weightsData]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => { for (const t of Object.values(timers)) clearTimeout(t); };
  }, []);

  const handleChange = useCallback((signalId: string, value: number) => {
    userModified.current.add(signalId);
    setWeights(prev => ({ ...prev, [signalId]: value }));
    setSavedSignals(prev => { const n = new Set(prev); n.delete(signalId); return n; });

    // Debounce the save — 600ms after user stops dragging
    clearTimeout(debounceTimers.current[signalId]);
    debounceTimers.current[signalId] = setTimeout(async () => {
      setSavingSignals(prev => new Set(prev).add(signalId));
      try {
        await setSignalWeight({
          variables: {
            input: {
              signalDefinitionId: signalId,
              weight: value,
              scope: 'PATHWAY',
              pathwayId,
            },
          },
        });
        setSavedSignals(prev => new Set(prev).add(signalId));
        setTimeout(() => setSavedSignals(prev => { const n = new Set(prev); n.delete(signalId); return n; }), 2000);
      } catch (err) {
        console.error('Failed to save weight:', err);
      } finally {
        setSavingSignals(prev => { const n = new Set(prev); n.delete(signalId); return n; });
      }
    }, 600);
  }, [pathwayId, setSignalWeight]);

  const signals = signalData?.signalDefinitions?.filter(s => s.isActive) ?? [];

  return (
    <div className="enc-dx-card">
      <div className="enc-dx-card-head">
        <div className="enc-dx-card-source-tag" style={{ background: 'var(--brand)', borderRadius: 5 }}>W</div>
        <div className="enc-dx-card-title-wrap">
          <div className="enc-dx-card-title">Signal Weights</div>
          <div className="enc-dx-card-source-label">Adjust how signals contribute to confidence</div>
        </div>
      </div>
      <div className="enc-evidence-section">
        {loading ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            Loading signal definitions...
          </div>
        ) : signals.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            No active signal definitions found.
          </div>
        ) : (
          <div className="enc-attr-list">
            {signals.map(signal => (
              <div key={signal.id} className="enc-attr-entry" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="enc-attr-label" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    {SIGNAL_DISPLAY_NAMES[signal.name] || signal.displayName}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 11, color: 'var(--ink-2)' }}>
                      {(weights[signal.id] ?? signal.defaultWeight).toFixed(2)}
                    </span>
                    {savingSignals.has(signal.id) && (
                      <span style={{ fontSize: 9, color: 'var(--ink-3)' }}>saving...</span>
                    )}
                    {savedSignals.has(signal.id) && (
                      <span style={{ fontSize: 9, color: 'var(--ok)' }}>{'\u2713'}</span>
                    )}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights[signal.id] ?? signal.defaultWeight}
                  onChange={e => handleChange(signal.id, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--brand)' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    Default: {signal.defaultWeight.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thresholds Card ─────────────────────────────────────────────────

function ThresholdsCard({ pathwayId }: { pathwayId: string }) {
  const { data: thresholdData, loading } = useQuery<{
    effectiveThresholds: ResolvedThresholds;
  }>(GET_EFFECTIVE_THRESHOLDS, { variables: { pathwayId } });

  const [setThresholds] = useMutation(SET_RESOLUTION_THRESHOLDS);
  const [autoResolve, setAutoResolve] = useState(0.85);
  const [suggest, setSuggest] = useState(0.60);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const thresholdsModified = useRef(false);

  useEffect(() => {
    if (thresholdData?.effectiveThresholds && !thresholdsModified.current) {
      setAutoResolve(thresholdData.effectiveThresholds.autoResolveThreshold);
      setSuggest(thresholdData.effectiveThresholds.suggestThreshold);
    }
  }, [thresholdData]);

  useEffect(() => {
    return () => { clearTimeout(debounceTimer.current); };
  }, []);

  const debouncedSave = useCallback((newSuggest: number, newAutoResolve: number) => {
    setSaved(false);
    if (newSuggest >= newAutoResolve) return;

    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await setThresholds({
          variables: {
            input: {
              autoResolveThreshold: newAutoResolve,
              suggestThreshold: newSuggest,
              scope: 'PATHWAY',
              pathwayId,
            },
          },
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        console.error('Failed to save thresholds:', err);
      } finally {
        setSaving(false);
      }
    }, 600);
  }, [pathwayId, setThresholds]);

  const handleSuggestChange = useCallback((v: number) => {
    thresholdsModified.current = true;
    const newAutoResolve = v >= autoResolve ? Math.min(1, v + 0.05) : autoResolve;
    setSuggest(v);
    if (v >= autoResolve) setAutoResolve(newAutoResolve);
    debouncedSave(v, newAutoResolve);
  }, [autoResolve, debouncedSave]);

  const handleAutoResolveChange = useCallback((v: number) => {
    thresholdsModified.current = true;
    const newSuggest = v <= suggest ? Math.max(0, v - 0.05) : suggest;
    setAutoResolve(v);
    if (v <= suggest) setSuggest(newSuggest);
    debouncedSave(newSuggest, v);
  }, [suggest, debouncedSave]);

  return (
    <div className="enc-dx-card">
      <div className="enc-dx-card-head">
        <div className="enc-dx-card-source-tag" style={{ background: 'var(--accent)', borderRadius: 5 }}>T</div>
        <div className="enc-dx-card-title-wrap">
          <div className="enc-dx-card-title">Resolution Thresholds</div>
          <div className="enc-dx-card-source-label">Define confidence boundaries for resolution types</div>
        </div>
        {saving && <span style={{ fontSize: 9, color: 'var(--ink-3)' }}>saving...</span>}
        {saved && <span style={{ fontSize: 9, color: 'var(--ok)' }}>{'\u2713'} saved</span>}
      </div>
      <div className="enc-evidence-section">
        {loading ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Visual scale */}
            <div className="enc-confidence-bar" style={{ height: 24, borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, left: 0, width: `${suggest * 100}%`, background: 'var(--danger-soft)' }} />
              <div style={{ position: 'absolute', inset: 0, left: `${suggest * 100}%`, width: `${(autoResolve - suggest) * 100}%`, background: 'var(--warn-soft)' }} />
              <div style={{ position: 'absolute', inset: 0, left: `${autoResolve * 100}%`, right: 0, background: 'var(--ok-soft)' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--warn)', left: `${suggest * 100}%` }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--ok)', left: `${autoResolve * 100}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              <span>Provider Decided</span>
              <span>System Suggested</span>
              <span>Auto-Resolved</span>
            </div>

            {/* Suggest slider */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--ink)' }}>Suggest Threshold</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-2)' }}>{suggest.toFixed(2)}</span>
              </div>
              <input
                type="range" min="0" max="0.95" step="0.05" value={suggest}
                onChange={e => handleSuggestChange(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--warn)' }}
              />
            </div>

            {/* Auto-resolve slider */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--ink)' }}>Auto-Resolve Threshold</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-2)' }}>{autoResolve.toFixed(2)}</span>
              </div>
              <input
                type="range" min="0.05" max="1" step="0.05" value={autoResolve}
                onChange={e => handleAutoResolveChange(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--ok)' }}
              />
            </div>

            {suggest >= autoResolve && (
              <div style={{ fontSize: 10, color: 'var(--danger)' }}>
                Suggest threshold must be less than auto-resolve threshold.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Evidence Card ───────────────────────────────────────────────────

function EvidenceCard({ pathwayId, nodes, edges }: { pathwayId: string; nodes: PathwayGraphNode[]; edges: PathwayGraphEdge[] }) {
  const [selectedNode, setSelectedNode] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    source: '',
    year: '',
    evidenceLevel: 'Level A',
    url: '',
    notes: '',
  });

  const { data, loading, refetch } = useQuery<{ adminEvidenceEntries: AdminEvidenceEntry[] }>(
    GET_ADMIN_EVIDENCE,
    { variables: { pathwayId, nodeIdentifier: selectedNode || undefined }, fetchPolicy: 'network-only' },
  );

  const [addEvidence, { loading: adding }] = useMutation(ADD_ADMIN_EVIDENCE, {
    onCompleted: () => {
      setFormData({ title: '', source: '', year: '', evidenceLevel: 'Level A', url: '', notes: '' });
      setShowForm(false);
      refetch();
    },
  });
  const [removeEvidence] = useMutation(REMOVE_ADMIN_EVIDENCE, { onCompleted: () => refetch() });

  const entries = data?.adminEvidenceEntries ?? [];

  // Group nodes by type for selector
  const grouped = new Map<string, PathwayGraphNode[]>();
  for (const n of nodes) {
    const list = grouped.get(n.type) || [];
    list.push(n);
    grouped.set(n.type, list);
  }
  const typeOrder = ['Stage', 'Step', 'DecisionPoint', 'Criterion', 'Medication', 'LabTest', 'Procedure'];
  const sortedTypes = [...grouped.keys()].sort((a, b) => {
    const ai = typeOrder.indexOf(a);
    const bi = typeOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const handleSubmit = useCallback(() => {
    if (!selectedNode || !formData.title.trim()) return;
    addEvidence({
      variables: {
        input: {
          pathwayId,
          nodeIdentifier: selectedNode,
          title: formData.title.trim(),
          source: formData.source.trim() || undefined,
          year: formData.year ? parseInt(formData.year, 10) : undefined,
          evidenceLevel: formData.evidenceLevel,
          url: formData.url.trim() || undefined,
          notes: formData.notes.trim() || undefined,
        },
      },
    });
  }, [selectedNode, formData, pathwayId, addEvidence]);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    borderRadius: 4,
    border: '1px solid var(--rule)',
    background: 'var(--canvas)',
    color: 'var(--ink)',
    fontSize: 12,
    fontFamily: 'var(--font-manrope)',
  };

  return (
    <div className="enc-dx-card">
      <div className="enc-dx-card-head">
        <div className="enc-dx-card-source-tag" style={{ background: 'var(--ai)', borderRadius: 5 }}>E</div>
        <div className="enc-dx-card-title-wrap">
          <div className="enc-dx-card-title">Evidence Management</div>
          <div className="enc-dx-card-source-label">Add and manage evidence entries for pathway nodes</div>
        </div>
      </div>

      {/* Node selector */}
      <div className="enc-evidence-section">
        <div className="enc-ev-h">
          <span>Select Node</span>
        </div>
        <select
          value={selectedNode}
          onChange={e => setSelectedNode(e.target.value)}
          style={{ ...inputStyle, marginBottom: 12 }}
        >
          <option value="">All nodes</option>
          {sortedTypes.map(type => (
            <optgroup key={type} label={type}>
              {grouped.get(type)!.map(node => {
                const props = node.properties as Record<string, unknown>;
                return (
                  <option key={node.id} value={node.id}>
                    {String(props.title || props.name || props.description || node.id)}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>

        {/* Evidence entries */}
        {loading ? (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>Loading...</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, fontStyle: 'italic' }}>
            No evidence entries{selectedNode ? ' for this node' : ''}.
          </div>
        ) : (
          <div className="enc-attr-list">
            {entries.map(entry => (
              <div key={entry.id} className="enc-attr-entry">
                <div className="enc-attr-content">
                  <div className="enc-attr-value" style={{ fontSize: 12 }}>{entry.title}</div>
                  <div className="enc-attr-label">
                    {entry.evidenceLevel}
                    {entry.source && ` \u00B7 ${entry.source}`}
                    {entry.year && ` (${entry.year})`}
                  </div>
                </div>
                <div className="enc-attr-actions">
                  <button
                    className="enc-mini-btn no"
                    onClick={() => removeEvidence({ variables: { id: entry.id } })}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add form */}
      {selectedNode && (
        <div className="enc-plan-section">
          {!showForm ? (
            <div
              className="enc-plan-locked"
              style={{ cursor: 'pointer' }}
              onClick={() => setShowForm(true)}
            >
              <div className="enc-plan-locked-info">
                <div className="enc-plan-locked-h">Add Evidence Entry</div>
                <div className="enc-plan-locked-sub">
                  Click to add a new evidence citation for the selected node.
                </div>
              </div>
              <span style={{ color: 'var(--brand)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em' }}>
                + Add
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--panel-2)', borderRadius: 6, padding: 16, border: '1px solid var(--rule)' }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.1em' }}>Title *</label>
                <input type="text" value={formData.title} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} placeholder="e.g. AHA Guidelines 2024" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.1em' }}>Source</label>
                  <input type="text" value={formData.source} onChange={e => setFormData(p => ({ ...p, source: e.target.value }))} placeholder="e.g. JAMA 2024" style={inputStyle} />
                </div>
                <div style={{ width: 80 }}>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.1em' }}>Year</label>
                  <input type="number" value={formData.year} onChange={e => setFormData(p => ({ ...p, year: e.target.value }))} placeholder="2024" style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.1em' }}>Evidence Level</label>
                <select value={formData.evidenceLevel} onChange={e => setFormData(p => ({ ...p, evidenceLevel: e.target.value }))} style={inputStyle}>
                  {EVIDENCE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.1em' }}>URL</label>
                <input type="url" value={formData.url} onChange={e => setFormData(p => ({ ...p, url: e.target.value }))} placeholder="https://doi.org/..." style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.1em' }}>Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} placeholder="Additional context..." rows={2} style={{ ...inputStyle, resize: 'none' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleSubmit}
                  disabled={adding || !formData.title.trim()}
                  className="enc-gen-plan-btn"
                  style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                >
                  {adding ? 'Adding...' : 'Add Evidence'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="enc-btn"
                  style={{ fontFamily: 'var(--font-manrope)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
