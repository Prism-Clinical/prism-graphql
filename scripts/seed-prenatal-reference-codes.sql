-- Reference codes for the routine-prenatal-care pathway (version 2).
--
-- Every medication and vaccine code the pathway's gates recognise on the medication list:
-- aspirin, folic acid, prenatal multivitamins, and the Tdap, RSV, influenza and COVID-19
-- vaccine products. All are RxNorm concepts verified on RxNav on 2026-10-04 (see
-- pathways/briefs/routine-prenatal-care-research-brief.md, section 0.8).
--
-- Why: the encounter simulator's code search reads clinical_code_reference, and its
-- medication picker searches system 'RXNORM' only. Without these rows a tester cannot find
-- or enter a prenatal vitamin or a vaccine, so the gates that read them cannot be exercised.
-- Vaccines are seeded as RXNORM (not CVX) for that reason.
--
-- Idempotent: safe to run any number of times. A code already present is left as it is,
-- except that a row whose description is still the import placeholder
-- '<auto-added from pathway upload>' is given its real name so it can be searched.
--
-- The influenza and COVID-19 products are seasonal (2025-2026 and 2026-2027): add the new
-- season's RxNorm concepts here, and to the pathway's gates, each year.
--
-- Run (not run by the build):
--   psql "$DATABASE_URL" -f scripts/seed-prenatal-reference-codes.sql

BEGIN;

INSERT INTO clinical_code_reference (code, system, description, category, is_common) VALUES
  ('1191', 'RXNORM', 'Aspirin (ingredient)', 'Antiplatelet', false),
  ('243670', 'RXNORM', 'Aspirin 81 mg oral tablet', 'Antiplatelet', false),
  ('318272', 'RXNORM', 'Aspirin 81 mg chewable tablet', 'Antiplatelet', false),
  ('4511', 'RXNORM', 'Folic acid (ingredient)', 'Prenatal vitamin', false),
  ('198640', 'RXNORM', 'Folic acid 0.4 mg oral tablet', 'Prenatal vitamin', false),
  ('310410', 'RXNORM', 'Folic acid 1 mg oral tablet', 'Prenatal vitamin', false),
  ('1119570', 'RXNORM', 'Vitafol-One (brand)', 'Prenatal vitamin', false),
  ('1119573', 'RXNORM', 'Vitafol-One prenatal multivitamin capsule', 'Prenatal vitamin', false),
  ('1100471', 'RXNORM', 'CitraNatal prenatal multivitamin pack', 'Prenatal vitamin', false),
  ('1248142', 'RXNORM', 'Prenatal multivitamin with folic acid 1 mg and iron carbonyl 90 mg, oral tablet', 'Prenatal vitamin', false),
  ('1116183', 'RXNORM', 'Prenatal multivitamin with folic acid 1 mg and ferrous fumarate 65 mg, oral tablet (branded)', 'Prenatal vitamin', false),
  ('1313925', 'RXNORM', 'Prenatal multivitamin with folic acid 1 mg and ferrous fumarate 29 mg, oral tablet', 'Prenatal vitamin', false),
  ('1485531', 'RXNORM', 'Prenatal multivitamin with DHA, folic acid 1.2 mg and ferrous fumarate 30 mg, oral capsule', 'Prenatal vitamin', false),
  ('2718464', 'RXNORM', 'Fluzone 2025-2026', 'Influenza vaccine', false),
  ('2718469', 'RXNORM', 'Fluzone 2025-2026 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2719212', 'RXNORM', 'Fluzone 2025-2026 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2719216', 'RXNORM', 'Fluzone 2025-2026 injectable suspension', 'Influenza vaccine', false),
  ('2746457', 'RXNORM', 'Fluzone 2026-2027', 'Influenza vaccine', false),
  ('2746462', 'RXNORM', 'Fluzone 2026-2027 injectable suspension', 'Influenza vaccine', false),
  ('2746468', 'RXNORM', 'Fluzone 2026-2027 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2746475', 'RXNORM', 'Fluzone 2026-2027 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2719306', 'RXNORM', 'Flublok 2025-2026', 'Influenza vaccine', false),
  ('2719311', 'RXNORM', 'Flublok 2025-2026 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2746444', 'RXNORM', 'Flublok 2026-2027', 'Influenza vaccine', false),
  ('2746449', 'RXNORM', 'Flublok 2026-2027 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2718369', 'RXNORM', 'Flucelvax 2025-2026', 'Influenza vaccine', false),
  ('2718374', 'RXNORM', 'Flucelvax 2025-2026 injectable suspension', 'Influenza vaccine', false),
  ('2718382', 'RXNORM', 'Flucelvax 2025-2026 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2746484', 'RXNORM', 'Flucelvax 2026-2027', 'Influenza vaccine', false),
  ('2746489', 'RXNORM', 'Flucelvax 2026-2027 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2720029', 'RXNORM', 'Fluarix 2025-2026', 'Influenza vaccine', false),
  ('2720034', 'RXNORM', 'Fluarix 2025-2026 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2749251', 'RXNORM', 'Fluarix 2026-2027', 'Influenza vaccine', false),
  ('2749256', 'RXNORM', 'Fluarix 2026-2027 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2718457', 'RXNORM', 'Flulaval 2025-2026', 'Influenza vaccine', false),
  ('2718462', 'RXNORM', 'Flulaval 2025-2026 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2747246', 'RXNORM', 'Flulaval 2026-2027', 'Influenza vaccine', false),
  ('2747251', 'RXNORM', 'Flulaval 2026-2027 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2718395', 'RXNORM', 'Afluria 2025-2026', 'Influenza vaccine', false),
  ('2718400', 'RXNORM', 'Afluria 2025-2026 0.5 mL prefilled syringe', 'Influenza vaccine', false),
  ('2718406', 'RXNORM', 'Afluria 2025-2026 injectable suspension', 'Influenza vaccine', false),
  ('2722600', 'RXNORM', 'Comirnaty 2025-2026', 'COVID-19 vaccine', false),
  ('2722605', 'RXNORM', 'Comirnaty 2025-2026 0.3 mL prefilled syringe', 'COVID-19 vaccine', false),
  ('2722614', 'RXNORM', 'Comirnaty 2025-2026 0.3 mL injection', 'COVID-19 vaccine', false),
  ('2722430', 'RXNORM', 'Spikevax 2025-2026', 'COVID-19 vaccine', false),
  ('2722435', 'RXNORM', 'Spikevax 2025-2026 0.25 mL prefilled syringe', 'COVID-19 vaccine', false),
  ('2722438', 'RXNORM', 'Spikevax 2025-2026 0.5 mL prefilled syringe', 'COVID-19 vaccine', false),
  ('2723009', 'RXNORM', 'Nuvaxovid 2025-2026', 'COVID-19 vaccine', false),
  ('2723014', 'RXNORM', 'Nuvaxovid 2025-2026 0.5 mL prefilled syringe', 'COVID-19 vaccine', false),
  ('2722656', 'RXNORM', 'Mnexspike 2025-2026', 'COVID-19 vaccine', false),
  ('2722661', 'RXNORM', 'Mnexspike 2025-2026 0.2 mL prefilled syringe', 'COVID-19 vaccine', false),
  ('583411', 'RXNORM', 'Boostrix', 'Tdap vaccine', false),
  ('1300370', 'RXNORM', 'Boostrix 0.5 mL prefilled syringe', 'Tdap vaccine', false),
  ('1300378', 'RXNORM', 'Boostrix 0.5 mL injection', 'Tdap vaccine', false),
  ('1300368', 'RXNORM', 'Tdap vaccine (SCD)', 'Tdap vaccine', false),
  ('1300377', 'RXNORM', 'Tdap vaccine (SCD)', 'Tdap vaccine', false),
  ('605718', 'RXNORM', 'Adacel', 'Tdap vaccine', false),
  ('1300191', 'RXNORM', 'Adacel 0.5 mL prefilled syringe', 'Tdap vaccine', false),
  ('1300206', 'RXNORM', 'Adacel 0.5 mL injection', 'Tdap vaccine', false),
  ('1300189', 'RXNORM', 'Tdap vaccine (SCD)', 'Tdap vaccine', false),
  ('1300205', 'RXNORM', 'Tdap vaccine (SCD)', 'Tdap vaccine', false),
  ('2642144', 'RXNORM', 'Abrysvo', 'RSV vaccine', false),
  ('2642148', 'RXNORM', 'Abrysvo 0.5 mL injection', 'RSV vaccine', false),
  ('2642142', 'RXNORM', 'RSV vaccine, RSVpreF (SCD)', 'RSV vaccine', false)
ON CONFLICT (code, system) DO UPDATE
  SET description = EXCLUDED.description,
      category = COALESCE(clinical_code_reference.category, EXCLUDED.category)
  WHERE clinical_code_reference.description = '<auto-added from pathway upload>';

COMMIT;
