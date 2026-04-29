'use client';

import { AttrStatus } from './types';

interface AssessmentPhaseProps {
  gdmAttrs: Record<number, AttrStatus>;
  gdmPlanRevealed: boolean;
  onConfirmAttr: (num: number) => void;
  onDismissAttr: (num: number) => void;
  onGeneratePlan: () => void;
}

/* ── Shared sub-components ───────────────────────────────── */

function MiniBtn({ type, onClick }: { type: 'ok' | 'no' | 'edit' | 'done'; onClick?: () => void }) {
  const labels = { ok: '\u2713', no: '\u2715', edit: '\u270E', done: '\u2713' };
  return (
    <button className={`enc-mini-btn ${type}`} onClick={onClick}>
      {labels[type]}
    </button>
  );
}

function PlanItem({
  icon,
  iconType,
  name,
  detail,
  because,
  layerDots,
  layerText,
  layerConflict,
  resolved,
}: {
  icon: string;
  iconType: string;
  name: string;
  detail: string;
  because?: string;
  layerDots?: string[];
  layerText?: string;
  layerConflict?: boolean;
  resolved?: boolean;
}) {
  const style = resolved
    ? { opacity: 0.65, background: 'var(--ok-soft)', borderColor: 'var(--ok-soft)' }
    : {};
  return (
    <div className="enc-plan-item" style={style}>
      <div className={`enc-plan-item-icon ${iconType}`} style={{ fontFamily: 'var(--font-jetbrains)' }}>
        {icon}
      </div>
      <div className="enc-plan-item-body" style={{ fontFamily: 'var(--font-manrope)' }}>
        <div className="enc-plan-item-name">
          {name}
          {resolved && <span style={{ color: 'var(--ok)', fontWeight: 600 }}>&thinsp;&#10003; resolved</span>}
        </div>
        <div className="enc-plan-item-detail">{detail}</div>
        {because && <div className="enc-plan-item-because">{because}</div>}
      </div>
      {layerDots && (
        <div
          className="enc-layer-indicator"
          style={layerConflict ? { background: 'var(--warn-soft)', border: '1px solid var(--warn)' } : {}}
        >
          {layerDots.map((d, i) => (
            <div key={i} className={`enc-layer-dot ${d}`} />
          ))}
          <span
            className="enc-layer-text"
            style={layerConflict ? { color: 'var(--warn)', fontFamily: 'var(--font-jetbrains)' } : { fontFamily: 'var(--font-jetbrains)' }}
          >
            {layerText}
          </span>
        </div>
      )}
      <div className="enc-plan-item-actions">
        {resolved ? (
          <MiniBtn type="done" />
        ) : (
          <>
            <MiniBtn type="edit" />
            <MiniBtn type="no" />
            <MiniBtn type="ok" />
          </>
        )}
      </div>
    </div>
  );
}

function PlanFooter({ total, approved }: { total: number; approved: number }) {
  return (
    <div className="enc-plan-card-foot">
      <div className="enc-plan-stats enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
        {total} recommendations &middot; <strong>{approved} approved</strong>
      </div>
      <div className="enc-plan-card-actions">
        <button className="enc-btn" style={{ fontFamily: 'var(--font-manrope)' }}>Reject all</button>
        <button className="enc-btn enc-btn-primary" style={{ fontFamily: 'var(--font-manrope)' }}>Approve all</button>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────── */

export default function AssessmentPhase({
  gdmAttrs,
  gdmPlanRevealed,
  onConfirmAttr,
  onDismissAttr,
  onGeneratePlan,
}: AssessmentPhaseProps) {
  const remaining = Object.values(gdmAttrs).filter((v) => v === 'pending').length;
  const allConfirmed = remaining === 0;

  return (
    <div className="enc-phase-content">
      <div className="enc-phase-heading">
        <div>
          <h1 className="enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Confirm <em>evidence</em>, then generate plan
          </h1>
          <div className="enc-subtitle" style={{ fontFamily: 'var(--font-manrope)' }}>
            For each diagnosis, review the clinical attributes Prism extracted. Once you&rsquo;ve
            confirmed the evidence, tap &ldquo;Generate plan&rdquo; to see the recommendations.
          </div>
        </div>
        <div className="enc-phase-heading-right enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          Status<br />
          <strong style={{ fontFamily: 'var(--font-newsreader)' }}>1 of 3 ready</strong>
        </div>
      </div>

      <div className="enc-assess-cards">
        {/* ═══ DX Card 1: GDM ═══ */}
        <div className="enc-dx-card">
          <div className="enc-dx-card-head">
            <div className="enc-dx-card-source-tag list" style={{ fontFamily: 'var(--font-jetbrains)' }}>L</div>
            <div className="enc-dx-card-title-wrap">
              <div className="enc-dx-card-title enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
                Gestational Diabetes{' '}
                <span className="enc-dx-card-icd enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                  O24.410
                </span>
              </div>
              <div className="enc-dx-card-source-label enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                From <span className="src-list">problem list</span> &middot; added at intake &middot; 2:14 PM
              </div>
            </div>
            <div className="enc-dx-card-status">
              <div className="enc-dx-card-confidence enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                <div
                  style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: allConfirmed ? 'var(--ok)' : 'var(--warn)',
                  }}
                />
                {allConfirmed ? 'evidence confirmed' : `${remaining} attribute${remaining > 1 ? 's' : ''} need review`}
              </div>
              <button className="enc-dx-card-remove" title="Remove from encounter">&times;</button>
            </div>
          </div>

          {/* Evidence */}
          <div className="enc-evidence-section">
            <div className="enc-ev-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              <span>&#9671; Evidence &mdash; Attributes</span>
              <span className={`enc-ev-pill ${allConfirmed ? 'done' : 'review'}`}>
                {allConfirmed ? 'all confirmed' : `${remaining} to confirm`}
              </span>
            </div>
            <div className="enc-attr-list">
              {/* Attr 1 */}
              <div className={`enc-attr-entry ${gdmAttrs[1] === 'pending' ? 'review' : gdmAttrs[1] === 'dismissed' ? 'dismissed' : 'auto'}`}>
                <div className="enc-attr-src-tag enc-src-ehr enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>EHR</div>
                <div className="enc-attr-content" style={{ fontFamily: 'var(--font-manrope)' }}>
                  <div className="enc-attr-label">2hr Post-Prandial &middot; target &lt;120</div>
                  <div className="enc-attr-value out">128 mg/dL &uarr;</div>
                </div>
                <div className="enc-attr-actions">
                  {gdmAttrs[1] === 'pending' ? (
                    <>
                      <MiniBtn type="edit" />
                      <MiniBtn type="no" onClick={() => onDismissAttr(1)} />
                      <MiniBtn type="ok" onClick={() => onConfirmAttr(1)} />
                    </>
                  ) : gdmAttrs[1] === 'dismissed' ? (
                    <span className="enc-mono" style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains)', textTransform: 'uppercase', letterSpacing: '.1em' }}>dismissed</span>
                  ) : (
                    <MiniBtn type="done" />
                  )}
                </div>
              </div>

              {/* Attr 2 */}
              <div className={`enc-attr-entry ${gdmAttrs[2] === 'pending' ? 'review' : gdmAttrs[2] === 'dismissed' ? 'dismissed' : 'auto'}`}>
                <div className="enc-attr-src-tag enc-src-aud enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>AUD</div>
                <div className="enc-attr-content" style={{ fontFamily: 'var(--font-manrope)' }}>
                  <div className="enc-attr-label">Diet adherence &middot; patient-reported</div>
                  <div className="enc-attr-value">&ldquo;Mostly &mdash; slipped on weekends&rdquo;</div>
                </div>
                <div className="enc-attr-actions">
                  {gdmAttrs[2] === 'pending' ? (
                    <>
                      <MiniBtn type="edit" />
                      <MiniBtn type="no" onClick={() => onDismissAttr(2)} />
                      <MiniBtn type="ok" onClick={() => onConfirmAttr(2)} />
                    </>
                  ) : gdmAttrs[2] === 'dismissed' ? (
                    <span className="enc-mono" style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains)', textTransform: 'uppercase', letterSpacing: '.1em' }}>dismissed</span>
                  ) : (
                    <MiniBtn type="done" />
                  )}
                </div>
              </div>

              {/* Attr 3 */}
              <div className={`enc-attr-entry ${gdmAttrs[3] === 'pending' ? 'review' : gdmAttrs[3] === 'dismissed' ? 'dismissed' : 'auto'}`}>
                <div className="enc-attr-src-tag enc-src-aud enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>AUD</div>
                <div className="enc-attr-content" style={{ fontFamily: 'var(--font-manrope)' }}>
                  <div className="enc-attr-label">Symptom check</div>
                  <div className="enc-attr-value">No polyuria, polydipsia, or hypoglycemic episodes</div>
                </div>
                <div className="enc-attr-actions">
                  {gdmAttrs[3] === 'pending' ? (
                    <>
                      <MiniBtn type="edit" />
                      <MiniBtn type="no" onClick={() => onDismissAttr(3)} />
                      <MiniBtn type="ok" onClick={() => onConfirmAttr(3)} />
                    </>
                  ) : gdmAttrs[3] === 'dismissed' ? (
                    <span className="enc-mono" style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains)', textTransform: 'uppercase', letterSpacing: '.1em' }}>dismissed</span>
                  ) : (
                    <MiniBtn type="done" />
                  )}
                </div>
              </div>

              {/* Auto-confirmed attrs */}
              {[
                { src: 'EHR', label: 'Fasting glucose \u00B7 at target', value: '94 mg/dL' },
                { src: 'EHR', label: 'HbA1c \u00B7 at target', value: '5.8%' },
                { src: 'EHR', label: 'Current medication', value: 'Metformin 500mg BID \u00B7 8w' },
              ].map((a, i) => (
                <div key={i} className="enc-attr-entry auto">
                  <div className="enc-attr-src-tag enc-src-ehr enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>{a.src}</div>
                  <div className="enc-attr-content" style={{ fontFamily: 'var(--font-manrope)' }}>
                    <div className="enc-attr-label">{a.label}</div>
                    <div className="enc-attr-value">{a.value}</div>
                  </div>
                  <div className="enc-attr-actions"><MiniBtn type="done" /></div>
                </div>
              ))}
            </div>
          </div>

          {/* Plan section */}
          <div className="enc-plan-section">
            {!gdmPlanRevealed ? (
              <div className="enc-plan-locked">
                <div className="enc-plan-locked-info" style={{ fontFamily: 'var(--font-manrope)' }}>
                  <div className="enc-plan-locked-h">Plan recommendations are ready</div>
                  <div className="enc-plan-locked-sub">
                    {allConfirmed
                      ? <strong>All confirmed &#10003;</strong>
                      : <>Confirm the <strong>{remaining} attribute{remaining > 1 ? 's' : ''} above</strong>, then generate the plan.</>
                    }{' '}
                    Recommendations will be tailored to what you confirm.
                  </div>
                </div>
                <button
                  className="enc-gen-plan-btn"
                  style={{ fontFamily: 'var(--font-manrope)' }}
                  disabled={!allConfirmed}
                  onClick={onGeneratePlan}
                >
                  <span className="icon">&#9889;</span> Generate plan
                </button>
              </div>
            ) : (
              <div style={{ animation: 'enc-fadeIn .4s' }}>
                <div className="enc-ev-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                  <span>&#9672; Care plan &mdash; generated from confirmed evidence</span>
                  <span className="enc-ev-pill" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                    3 items &middot; 0 approved
                  </span>
                </div>
                <div className="enc-plan-list">
                  <PlanItem
                    icon="Rx" iconType="rx"
                    name="Increase Metformin 500 \u2192 750mg BID"
                    detail="Medication adjustment \u00B7 new order"
                    because="2hr PP above target despite adherent diet"
                    layerDots={['inst', 'clin', 'off']} layerText="inst + clin"
                  />
                  <PlanItem
                    icon="Lab" iconType="lab"
                    name="Repeat fasting + 2hr PP glucose @ 30w"
                    detail="Lab order \u00B7 fasting specimen"
                    because="Validate medication adjustment response"
                    layerDots={['inst', 'clin', 'off']} layerText="aligned"
                  />
                  <PlanItem
                    icon="Edu" iconType="edu"
                    name="Weekend dietary counseling"
                    detail="Patient education \u00B7 targeted"
                    because="Patient reported weekend adherence lapses"
                    layerDots={['off', 'clin', 'off']} layerText="clinician"
                  />
                </div>
              </div>
            )}
          </div>

          {gdmPlanRevealed && <PlanFooter total={3} approved={0} />}
        </div>

        {/* ═══ DX Card 2: CHTN ═══ */}
        <div className="enc-dx-card">
          <div className="enc-dx-card-head">
            <div className="enc-dx-card-source-tag list" style={{ fontFamily: 'var(--font-jetbrains)' }}>L</div>
            <div className="enc-dx-card-title-wrap">
              <div className="enc-dx-card-title enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
                Chronic Hypertension{' '}
                <span className="enc-dx-card-icd enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>O10.012</span>
              </div>
              <div className="enc-dx-card-source-label enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                From <span className="src-list">problem list</span> &middot; added at intake &middot; 2:14 PM
              </div>
            </div>
            <div className="enc-dx-card-status">
              <div className="enc-dx-card-confidence enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)' }} />
                evidence confirmed
              </div>
              <button className="enc-dx-card-remove" title="Remove">&times;</button>
            </div>
          </div>

          <div className="enc-evidence-section">
            <div className="enc-ev-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              <span>&#9671; Evidence &mdash; Attributes</span>
              <span className="enc-ev-pill done">all confirmed</span>
            </div>
            <div className="enc-attr-list">
              {[
                { src: 'VIT', cls: 'enc-src-vit', label: 'Blood pressure \u00B7 today, borderline', value: '128/82 mmHg', out: true },
                { src: 'AUD', cls: 'enc-src-aud', label: 'Home BP readings', value: '120s\u2013130s / 78\u201384, max 132/84 this week' },
                { src: 'AUD', cls: 'enc-src-aud', label: 'Preeclampsia symptoms', value: 'Denies HA, visual changes, RUQ pain' },
                { src: 'EHR', cls: 'enc-src-ehr', label: 'Urine protein dipstick', value: 'Negative' },
              ].map((a, i) => (
                <div key={i} className="enc-attr-entry auto">
                  <div className={`enc-attr-src-tag ${a.cls} enc-mono`} style={{ fontFamily: 'var(--font-jetbrains)' }}>{a.src}</div>
                  <div className="enc-attr-content" style={{ fontFamily: 'var(--font-manrope)' }}>
                    <div className="enc-attr-label">{a.label}</div>
                    <div className={`enc-attr-value ${a.out ? 'out' : ''}`}>{a.value}</div>
                  </div>
                  <div className="enc-attr-actions"><MiniBtn type="done" /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="enc-plan-section">
            <div style={{ animation: 'enc-fadeIn .4s' }}>
              <div className="enc-ev-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                <span>&#9672; Care plan &mdash; generated from confirmed evidence</span>
                <span className="enc-ev-pill" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  3 items &middot; 0 approved
                </span>
              </div>
              <div className="enc-plan-list">
                <PlanItem
                  icon="Lab" iconType="lab"
                  name="Urine protein:creatinine ratio"
                  detail="Spot urine \u00B7 today"
                  because="Quantitative baseline for PEC surveillance"
                  layerDots={['inst', 'clin', 'off']} layerText="aligned"
                />
                <PlanItem
                  icon="US" iconType="img"
                  name="Growth ultrasound @ 30 weeks"
                  detail="Imaging order \u00B7 OB growth scan"
                  because="CHTN + GDM \u2014 institutional override (default 32w)"
                  layerDots={['inst', 'clin', 'pt']} layerText="conflict \u26A0" layerConflict
                />
                <PlanItem
                  icon="Rx" iconType="rx"
                  name="Continue ASA 81mg daily \u2192 36w"
                  detail="Medication \u00B7 continue existing"
                  because="Standard PEC prophylaxis \u00B7 A-grade"
                  layerDots={['inst', 'clin', 'off']} layerText="guideline"
                />
              </div>
            </div>
          </div>
          <PlanFooter total={3} approved={0} />
        </div>

        {/* ═══ DX Card 3: Routine 28w ═══ */}
        <div className="enc-dx-card">
          <div className="enc-dx-card-head">
            <div className="enc-dx-card-source-tag verbal" style={{ fontFamily: 'var(--font-jetbrains)' }}>V</div>
            <div className="enc-dx-card-title-wrap">
              <div className="enc-dx-card-title enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
                Routine Prenatal &mdash; 28 weeks{' '}
                <span className="enc-dx-card-icd enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>Z34.83</span>
              </div>
              <div className="enc-dx-card-source-label enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                Captured from <span className="src-verbal">your conversation</span> &middot; 2:14 PM &middot; &ldquo;routine 28-week visit&rdquo;
              </div>
            </div>
            <div className="enc-dx-card-status">
              <div className="enc-dx-card-confidence enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)' }} />
                evidence confirmed
              </div>
              <button className="enc-dx-card-remove" title="Remove">&times;</button>
            </div>
          </div>

          <div className="enc-evidence-section">
            <div className="enc-ev-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              <span>&#9671; Evidence &mdash; Attributes</span>
              <span className="enc-ev-pill done">all confirmed</span>
            </div>
            <div className="enc-attr-list enc-attr-grid">
              {[
                { src: 'EXA', cls: 'enc-src-exa', label: 'Fundal height \u00B7 = GA', value: '28 cm' },
                { src: 'VIT', cls: 'enc-src-vit', label: 'FHR \u00B7 reassuring', value: '142 bpm' },
                { src: 'AUD', cls: 'enc-src-aud', label: 'Fetal movement', value: 'Good \u2014 "baby moving a lot"' },
                { src: 'EHR', cls: 'enc-src-ehr', label: 'Rh status', value: 'Rh+ (no RhoGAM)' },
              ].map((a, i) => (
                <div key={i} className="enc-attr-entry auto">
                  <div className={`enc-attr-src-tag ${a.cls} enc-mono`} style={{ fontFamily: 'var(--font-jetbrains)' }}>{a.src}</div>
                  <div className="enc-attr-content" style={{ fontFamily: 'var(--font-manrope)' }}>
                    <div className="enc-attr-label">{a.label}</div>
                    <div className="enc-attr-value">{a.value}</div>
                  </div>
                  <div className="enc-attr-actions"><MiniBtn type="done" /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="enc-plan-section">
            <div style={{ animation: 'enc-fadeIn .4s' }}>
              <div className="enc-ev-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                <span>&#9672; Care plan &mdash; generated from confirmed evidence</span>
                <span className="enc-ev-pill" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  2 items &middot; 1 approved
                </span>
              </div>
              <div className="enc-plan-list">
                <PlanItem
                  icon="Vac" iconType="vac"
                  name="Tdap vaccine \u2014 administer today"
                  detail="Immunization \u00B7 27\u201336w window"
                  because="GA within standard window \u00B7 ACIP A-grade"
                  layerDots={['inst', 'clin', 'off']} layerText="guideline"
                />
                <PlanItem
                  icon="Vac" iconType="vac"
                  name="RhoGAM \u2014 not indicated"
                  detail="Patient Rh-positive \u00B7 auto-resolved"
                  resolved
                />
              </div>
            </div>
          </div>
          <PlanFooter total={2} approved={1} />
        </div>
      </div>
    </div>
  );
}
