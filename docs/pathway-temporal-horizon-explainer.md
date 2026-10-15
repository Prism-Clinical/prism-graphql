# Teaching Prism the Difference Between "Ever" and "Recently"

**A plain-language summary of the Clinical Pathway Temporal Horizon work**
Last updated 2026-08-03

---

## The problem in one sentence

Prism's clinical pathways could ask *whether* something was true about a patient, but not *when* — so a lab result from five years ago counted exactly the same as one from last week.

## What that looks like in practice

A clinical pathway is a decision map. At each fork it asks a question about the patient and takes a branch based on the answer:

> *Is the patient's A1c above 9?*
> *Does the patient have diabetes?*
> *Is the patient currently on a beta blocker?*

Today, Prism answers those questions by searching everything it knows about the patient and reporting whether it found a match. That works — until you notice what it quietly ignores:

| The pathway author means | What Prism actually checked |
|---|---|
| "A1c above 9 **on a recent test**" | Any A1c on file, including one from 2019 |
| "**Currently** has diabetes" | Ever recorded as having diabetes, including a resolved diagnosis |
| "**Actively** prescribed a beta blocker" | Any beta blocker order, including ones stopped years ago |

There is a second, subtler problem. Because the system reads the clock at the moment it evaluates, the *same* patient encounter re-opened next week could take a different branch than it did today — with no record of why. That makes a decision hard to explain after the fact, which matters a great deal in a clinical setting.

None of this is a bug in the ordinary sense. The system does what it was built to do. It was simply built without a concept of time, and clinical questions almost always have one hiding inside them.

## What we are building

Three things, in plain terms.

**1. Authors say how far back to look.** Every question in a pathway gets an explicit time window — what we call a *horizon*. An author can say "within the last 90 days," "during this visit," "in the past year," or "ever." If they don't say, the platform supplies a sensible default for that kind of data.

**2. Authors say what clinical state counts.** Separately from *when*, an author says *what* counts: only active conditions, only resolved ones, or any. Today that decision is buried in code and applied invisibly; now it's a visible choice on the question itself.

**3. Every encounter gets a fixed clock.** When a patient encounter starts, Prism stamps the moment and uses that single instant for every time calculation in that encounter — including when someone re-opens it later. Re-examining an encounter now reproduces exactly what it decided the first time.

Underneath all three, a safety filter runs that authors cannot switch off: records the source system has flagged as *entered in error* or *refuted* are excluded from clinical decisions regardless of any other setting.

## Why it matters

**Better clinical accuracy.** "Is this patient's blood sugar poorly controlled?" and "was it ever poorly controlled?" are different questions with different answers and different treatment implications. Prism can now tell them apart.

**Authors get control, without needing an engineer.** Time windows become part of authoring the pathway, the same way the clinical question itself is. Changing "recent" from 90 days to 6 months is an authoring decision, not a code change.

**Decisions become explainable.** Because each answer records which facts it used, which it excluded, and why, we can show a clinician *why* the pathway recommended what it did — not just what it recommended. That is the foundation for trust, and for review after the fact.

**Uncertainty is handled honestly.** Real clinical data is incomplete: undated results, missing statuses, conflicting records. Rather than guessing, the system distinguishes "no" from "we can't tell," and errs on the side of caution where it counts — an uncertain value never silently satisfies a threshold.

**Changes ship safely.** Every set of platform defaults is versioned. An encounter records which version it ran under, and that version's meaning is frozen permanently. When we improve a default, existing behavior is unaffected until we deliberately switch over — and we can compare old and new side by side first.

## The one deliberate change in behavior

Most of this work is invisible: existing pathways keep behaving exactly as they do today until we choose to activate the new defaults.

One default is changing on purpose. Lab results currently have no expiry — a decade-old value is treated as current. Under the new defaults, labs look back **90 days** unless the author says otherwise. This is a genuine change in what some pathways decide, which is why it is versioned, disclosed, and switched on deliberately rather than by surprise.

## Where the work stands

The work is being delivered in nine stages, each independently reviewed and tested before the next begins.

| Stage | What it delivers | Status |
|---|---|---|
| 1 | The rules for reading dates and matching them against a time window | **Delivered** |
| 2 | The fixed per-encounter clock | **Delivered** |
| 3 | Platform defaults, author overrides, and how they layer | **Delivered** |
| 5 | Turning patient data into the form the new rules consume | Planned, in review |
| 4 | Switching the decision engine over to the new rules | Next |
| 6–9 | Authoring format, data import, the explanation trail, and the authoring UI | Planned |

Stages 4 and 5 were deliberately reordered during planning: building the engine first would have required guesswork about data that stage 5 supplies properly.

**Nothing is switched on for users yet.** Every stage so far adds capability without changing what any existing pathway decides. The visible change arrives when the authoring controls ship and we activate the new defaults — both deliberate, reviewable steps.

## How we know this is right

Every stage has been reviewed before it was built and again after — roughly a dozen review rounds and about sixty findings so far. A few examples of what that caught, because they say more about the process than a summary would.

**We were doing work before checking whether we should.** When a patient matches several pathways at once, the system handles them one after another. Our safety check ran *inside* that sequence — so if the third pathway failed, the first two had already been saved, and the run then stopped. That leaves orphaned records: half a decision, with nothing tying it together. It now checks every pathway first and writes nothing unless all of them pass.

**Silence was being treated as agreement.** Several findings were the same shape: an author writes a setting slightly wrong — a misspelled name, an empty section — and the system quietly ignored it and used the platform default instead. The author sees their setting saved and believes it is in force; it never is. That is the worst kind of failure, because nobody finds out. Anything unrecognised is now rejected outright, naming what is wrong and where.

**Our safety net had holes in it — three separate times.** Reviews kept finding tests that *looked* like they checked something but would have passed whether the feature worked or not: an example built the wrong way, so it never exercised the case it claimed to; a stand-in used during testing set to always succeed, so it could not detect the failure it existed to catch. The code was largely right — the proof that it was right was not. Each was rewritten so it genuinely fails when the feature breaks.

**We were also being too cautious in one place.** Our check was examining clinical questions attached to parts of a pathway the system never actually asks — leftovers from earlier edits. It would have blocked an encounter over a question that has no effect on anything. We narrowed it to exactly what gets used.

**Two reviews were wrong, and we showed why.** Review here is a dialogue, not dictation. One proposed a fix that would have worsened the over-blocking above while leaving the real gap untouched; we addressed the underlying issue differently. Another reported our test baseline was wrong; re-running the measurement showed the reviewer had measured a copy of our own changes rather than the original.

**And one review disagreement uncovered a real gap in the plan.** Pathways can express a clinical question in two different styles, and only one of them would have honoured the new time windows — meaning the same question could behave differently depending on how it was written. That is now a documented prerequisite before the new defaults are switched on. It surfaced from an argument, not a checklist.

## What we still owe

Two open items are tracked and neither is a surprise:

- **Older encounters.** Encounters created before the fixed-clock work cannot be re-examined under the new rules, because they never recorded the clock the new rules need. We need to decide whether to backfill them or accept that they are read-only history. This affects internal authoring and simulation data, not live patient care.
- **One authoring style is not yet covered.** Pathways can express a clinical question in two ways, and only one of them currently honors time windows. Closing that gap is a prerequisite for switching the new defaults on, and it is scheduled into stage 4.

---

**In short:** we are teaching Prism that clinical facts have a shelf life, giving pathway authors direct control over it, and making every resulting decision reproducible and explainable — without changing what any existing pathway does until we deliberately choose to.
