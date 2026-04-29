'use client';

export default function IntakePhase() {
  return (
    <div className="enc-phase-content">
      <div className="enc-phase-heading">
        <div>
          <h1 className="enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Set today&rsquo;s <em>diagnoses</em>
          </h1>
          <div className="enc-subtitle" style={{ fontFamily: 'var(--font-manrope)' }}>
            Three ways to add diagnoses to this encounter. Each diagnosis you add stays visible
            in the tray above and carries a tag showing where it came from. You stay in charge
            &mdash; Prism only structures what you decide.
          </div>
        </div>
        <div className="enc-phase-heading-right enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          Encounter dx<br />
          <strong style={{ fontFamily: 'var(--font-newsreader)' }}>3 added</strong>
        </div>
      </div>

      <div className="enc-intake-grid">
        {/* Door 1: Verbal Capture */}
        <div className="enc-door-card">
          <div className="enc-door-head">
            <div className="enc-door-mark verbal enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>V</div>
            <div className="enc-door-title-wrap">
              <div className="enc-door-title enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
                Live capture
              </div>
              <div className="enc-door-sub enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                From your conversation
              </div>
            </div>
            <div className="enc-door-count verbal enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              1 detected
            </div>
          </div>
          <div className="enc-door-body">
            <div className="enc-verbal-entry added">
              <div className="enc-verbal-quote" style={{ fontFamily: 'var(--font-newsreader)' }}>
                &ldquo;We&rsquo;re going to focus on her{' '}
                <span className="highlight">routine 28-week visit</span> today, plus her diabetes
                and blood pressure.&rdquo;
              </div>
              <div className="enc-verbal-meta">
                <div className="enc-verbal-detected" style={{ fontFamily: 'var(--font-manrope)' }}>
                  <div className="enc-verbal-detected-dot" />
                  Detected: <strong>Routine prenatal 28w &middot; Z34.83</strong>
                </div>
                <div className="enc-verbal-time enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                  2:14 PM
                </div>
              </div>
              <div className="enc-verbal-added-confirm" style={{ fontFamily: 'var(--font-manrope)' }}>
                &#10003; Added to encounter
              </div>
            </div>

            <div className="enc-verbal-idle" style={{ fontFamily: 'var(--font-newsreader)' }}>
              <div className="enc-verbal-idle-mark" />
              Listening for diagnoses you mention&hellip;
            </div>
          </div>
        </div>

        {/* Door 2: Problem List Opt-in */}
        <div className="enc-door-card">
          <div className="enc-door-head">
            <div className="enc-door-mark list enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>L</div>
            <div className="enc-door-title-wrap">
              <div className="enc-door-title enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
                From problem list
              </div>
              <div className="enc-door-sub enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                Select what&rsquo;s relevant today
              </div>
            </div>
            <div className="enc-door-count list enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              2 added
            </div>
          </div>
          <div className="enc-door-body">
            <div className="enc-list-instruction" style={{ fontFamily: 'var(--font-manrope)' }}>
              Maria has <strong>5 chronic problems</strong>. Tap the ones you&rsquo;d like to
              address in today&rsquo;s encounter.
            </div>

            <div className="enc-list-checklist">
              {[
                { icd: 'O24.410', name: 'Gestational diabetes', meta: 'dx 22w', checked: true },
                { icd: 'O10.012', name: 'Chronic hypertension in pregnancy', meta: 'on ASA', checked: true },
                { icd: 'E66.01', name: 'Obesity, BMI 32', meta: 'background', checked: false },
                { icd: 'F41.1', name: 'Generalized anxiety disorder', meta: 'stable', checked: false },
                { icd: 'O34.219', name: 'Prior c-section, uncomplicated', meta: 'history', checked: false },
              ].map((item) => (
                <div
                  key={item.icd}
                  className={`enc-list-item ${item.checked ? 'checked' : ''}`}
                  style={{ fontFamily: 'var(--font-manrope)' }}
                >
                  <div className="enc-list-checkbox">{item.checked ? '\u2713' : ''}</div>
                  <div className="enc-list-icd enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                    {item.icd}
                  </div>
                  <div className="enc-list-name">{item.name}</div>
                  <div className="enc-list-meta enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                    {item.meta}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Door 3: Manual CTA */}
        <div className="enc-door-3-cta">
          <div className="enc-door-3-mark-lg enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>M</div>
          <div className="enc-door-3-text">
            <div className="enc-door-3-title enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
              Need to add something new?
            </div>
            <div className="enc-door-3-sub" style={{ fontFamily: 'var(--font-manrope)' }}>
              Use the <strong>&ldquo;Add diagnosis&hellip;&rdquo;</strong> bar at the top of every
              screen. Type to search ICD-10, or tap the mic to dictate. Available throughout the
              entire encounter &mdash; no need to come back here.
            </div>
          </div>
          <div className="enc-door-3-arrow enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            &uarr; above &uarr;
          </div>
        </div>
      </div>
    </div>
  );
}
