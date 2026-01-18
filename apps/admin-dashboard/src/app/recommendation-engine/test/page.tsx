'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRecommend, useExplainRecommendation, PatientContext, LayerSummary, Recommendation, MatchReason } from '@/lib/hooks/useRecommendationEngine';
import DecisionExplorerModal from '@/components/recommendation-engine/DecisionExplorerModal';

const SAMPLE_CONTEXTS: { name: string; context: PatientContext }[] = [
  {
    name: 'Strep Throat - Pediatric',
    context: {
      condition_codes: ['J02.0', 'J02.9'],
      age: 8,
      sex: 'male',
    },
  },
  {
    name: 'Strep Throat - Adult',
    context: {
      condition_codes: ['J02.0'],
      age: 35,
      sex: 'female',
    },
  },
  {
    name: 'Type 2 Diabetes',
    context: {
      condition_codes: ['E11.9'],
      age: 55,
      sex: 'male',
      comorbidities: ['I10'], // Hypertension
      risk_factors: ['obesity', 'smoking'],
    },
  },
  {
    name: 'UTI in Pregnancy',
    context: {
      condition_codes: ['O23.10', 'N39.0'],
      age: 28,
      sex: 'female',
    },
  },
  {
    name: 'GERD',
    context: {
      condition_codes: ['K21.0'],
      age: 45,
      sex: 'male',
    },
  },
];

export default function TestConsolePage() {
  const [conditionCodes, setConditionCodes] = useState('');
  const [age, setAge] = useState<string>('');
  const [sex, setSex] = useState<string>('');
  const [comorbidities, setComorbidities] = useState('');
  const [riskFactors, setRiskFactors] = useState('');
  const [maxResults, setMaxResults] = useState(5);
  const [enablePersonalization, setEnablePersonalization] = useState(true);

  const { recommend, result, loading, error } = useRecommend();
  const { explain, explanation, loading: explainLoading } = useExplainRecommendation();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);
  const [currentPatientContext, setCurrentPatientContext] = useState<PatientContext | null>(null);
  const [currentLayerSummaries, setCurrentLayerSummaries] = useState<LayerSummary[]>([]);

  const handleTest = async () => {
    const context: PatientContext = {
      condition_codes: conditionCodes.split(',').map(c => c.trim()).filter(Boolean),
      age: age ? parseInt(age) : undefined,
      sex: sex || undefined,
      comorbidities: comorbidities ? comorbidities.split(',').map(c => c.trim()).filter(Boolean) : undefined,
      risk_factors: riskFactors ? riskFactors.split(',').map(c => c.trim()).filter(Boolean) : undefined,
    };

    try {
      const result = await recommend(context, { maxResults, enablePersonalization });
      if (result?.sessionId) {
        setSelectedSessionId(result.sessionId);
      }
      // Store context and layer summaries for decision tree modal
      setCurrentPatientContext(context);
      if (result?.layerSummaries) {
        setCurrentLayerSummaries(result.layerSummaries);
      }
    } catch (err) {
      console.error('Recommendation failed:', err);
    }
  };

  const loadSample = (sample: typeof SAMPLE_CONTEXTS[0]) => {
    setConditionCodes(sample.context.condition_codes.join(', '));
    setAge(sample.context.age?.toString() || '');
    setSex(sample.context.sex || '');
    setComorbidities(sample.context.comorbidities?.join(', ') || '');
    setRiskFactors(sample.context.risk_factors?.join(', ') || '');
  };

  const handleExplain = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    await explain(sessionId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href="/recommendation-engine" className="hover:text-gray-700">
            Recommendation Engine
          </Link>
          <span>/</span>
          <span>Test Console</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Test Console</h1>
        <p className="mt-1 text-sm text-gray-600">
          Test the three-layer recommendation engine with sample patient data.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="space-y-6">
          {/* Sample Data */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-medium text-gray-900 mb-3">Quick Load Sample</h3>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_CONTEXTS.map((sample) => (
                <button
                  key={sample.name}
                  onClick={() => loadSample(sample)}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                >
                  {sample.name}
                </button>
              ))}
            </div>
          </div>

          {/* Input Form */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-medium text-gray-900 mb-4">Patient Context</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Condition Codes (comma-separated) *
                </label>
                <input
                  type="text"
                  value={conditionCodes}
                  onChange={(e) => setConditionCodes(e.target.value)}
                  placeholder="J02.0, J02.9"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Age
                  </label>
                  <input
                    type="number"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="35"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sex
                  </label>
                  <select
                    value={sex}
                    onChange={(e) => setSex(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Not specified</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comorbidities (comma-separated)
                </label>
                <input
                  type="text"
                  value={comorbidities}
                  onChange={(e) => setComorbidities(e.target.value)}
                  placeholder="I10, E78.0"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Risk Factors (comma-separated)
                </label>
                <input
                  type="text"
                  value={riskFactors}
                  onChange={(e) => setRiskFactors(e.target.value)}
                  placeholder="smoking, obesity"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Results
                  </label>
                  <input
                    type="number"
                    value={maxResults}
                    onChange={(e) => setMaxResults(parseInt(e.target.value))}
                    min={1}
                    max={20}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enablePersonalization}
                      onChange={(e) => setEnablePersonalization(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Enable Layer 3</span>
                  </label>
                </div>
              </div>

              <button
                onClick={handleTest}
                disabled={loading || !conditionCodes.trim()}
                className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Running...' : 'Run Recommendation'}
              </button>
            </div>
          </div>
        </div>

        {/* Results Panel */}
        <div className="space-y-6">
          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error.message}
            </div>
          )}

          {/* Results */}
          {result && (
            <>
              {/* Summary */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-medium text-gray-900">Results Summary</h3>
                  <span className="text-sm text-gray-500">
                    {result.totalProcessingTimeMs.toFixed(1)}ms
                  </span>
                </div>

                {/* Layer Pipeline */}
                <div className="flex items-center gap-2 mb-4">
                  {result.layerSummaries.map((layer: LayerSummary, i: number) => (
                    <div key={layer.layer} className="flex items-center">
                      {i > 0 && <span className="mx-2 text-gray-400">→</span>}
                      <div className={`px-3 py-2 rounded-lg text-sm ${
                        layer.layer === 1 ? 'bg-blue-100 text-blue-800' :
                        layer.layer === 2 ? 'bg-green-100 text-green-800' :
                        'bg-purple-100 text-purple-800'
                      }`}>
                        <div className="font-medium">Layer {layer.layer}</div>
                        <div className="text-xs opacity-75">
                          {layer.candidateCount} results • {layer.processingTimeMs.toFixed(0)}ms
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-sm text-gray-500">
                  Session: <code className="bg-gray-100 px-1 rounded">{result.sessionId}</code>
                  <button
                    onClick={() => handleExplain(result.sessionId)}
                    className="ml-2 text-blue-600 hover:text-blue-800"
                    disabled={explainLoading}
                  >
                    {explainLoading ? 'Loading...' : 'View Details'}
                  </button>
                </div>
              </div>

              {/* Recommendations */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b">
                  <h3 className="font-medium text-gray-900">
                    Recommendations ({result.recommendations.length})
                  </h3>
                </div>
                <div className="divide-y">
                  {result.recommendations.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
                      No recommendations found for this patient context.
                    </div>
                  ) : (
                    result.recommendations.map((rec: Recommendation) => (
                      <div key={rec.carePlanId} className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-medium text-gray-900">
                                #{rec.rank} {rec.title}
                              </div>
                              <button
                                onClick={() => setSelectedRecommendation(rec)}
                                className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors flex items-center gap-1"
                                title="Open Decision Explorer"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                Explore
                              </button>
                            </div>
                            {rec.variantName && (
                              <div className="text-sm text-gray-500">
                                Variant: {rec.variantName}
                                {rec.variantGroupName && ` (${rec.variantGroupName})`}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-sm font-medium">
                              Score: {rec.score.toFixed(1)}
                            </div>
                            {rec.embeddingSimilarity && (
                              <div className="text-xs text-gray-500">
                                Similarity: {(rec.embeddingSimilarity * 100).toFixed(0)}%
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Match Type */}
                        {rec.matchType && (
                          <span className={`inline-block px-2 py-1 text-xs rounded mr-2 ${
                            rec.matchType === 'exact_code' ? 'bg-green-100 text-green-700' :
                            rec.matchType === 'prefix_code' ? 'bg-blue-100 text-blue-700' :
                            rec.matchType === 'embedding_similarity' ? 'bg-purple-100 text-purple-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {rec.matchType.replace('_', ' ')}
                          </span>
                        )}

                        {/* Condition Codes */}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {rec.conditionCodes.slice(0, 4).map((code: string) => (
                            <span key={code} className="px-2 py-0.5 text-xs bg-gray-100 rounded">
                              {code}
                            </span>
                          ))}
                        </div>

                        {/* Reasons */}
                        {rec.reasons.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <div className="text-xs text-gray-500 mb-1">Matching Reasons:</div>
                            <div className="space-y-1">
                              {rec.reasons.slice(0, 3).map((reason: MatchReason, i: number) => (
                                <div key={i} className="flex justify-between text-xs">
                                  <span className="text-gray-600">{reason.description}</span>
                                  {reason.scoreImpact !== 0 && (
                                    <span className={reason.scoreImpact > 0 ? 'text-green-600' : 'text-red-600'}>
                                      {reason.scoreImpact > 0 ? '+' : ''}{reason.scoreImpact.toFixed(1)}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {rec.reasons.length > 3 && (
                                <div className="text-xs text-gray-400">
                                  +{rec.reasons.length - 3} more reasons
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {/* Explanation Modal */}
          {explanation && selectedSessionId === result?.sessionId && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-medium text-gray-900 mb-4">Session Details</h3>
              <pre className="bg-gray-50 p-4 rounded-lg overflow-auto text-xs max-h-96">
                {JSON.stringify(explanation, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* API Documentation */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="font-medium text-gray-900 mb-4">API Testing</h3>
        <p className="text-sm text-gray-600 mb-4">
          You can also test via curl or your API client:
        </p>
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
{`# Test recommendation
curl -X POST http://localhost:8084/engine/recommend \\
  -H "Content-Type: application/json" \\
  -d '{
    "patient_context": {
      "condition_codes": ["J02.0"],
      "age": 35,
      "sex": "female"
    },
    "max_results": 5,
    "enable_personalization": true
  }'

# Explain a session
curl http://localhost:8084/engine/explain/{session_id}

# Test individual layers (see /engine/debug endpoints)`}
        </pre>
      </div>

      {/* Decision Explorer Modal */}
      {selectedRecommendation && currentPatientContext && (
        <DecisionExplorerModal
          isOpen={!!selectedRecommendation}
          onClose={() => setSelectedRecommendation(null)}
          recommendation={selectedRecommendation}
          patientContext={currentPatientContext}
          layerSummaries={currentLayerSummaries}
        />
      )}
    </div>
  );
}
