-- Migration 071: every ingredient and the product-level classes of a normalised medication.
--
-- Josh, 2026-10-04: "Match the vaccine, not the brand." A pathway gate may now
-- match a chart medication by what it IS — an ingredient
-- (`system: "RXNORM_INGREDIENT"`) or a product-level ATC class
-- (`system: "ATC"`) — instead of by a list of product codes. That needs more
-- than `medication_normalization_cache` kept:
--
--   - it stored ONE ingredient (the first RxNav returns), so a prenatal
--     multivitamin was cached as "thiamine" and a Tdap as its first antigen;
--   - its `atc_classes` are that one ingredient's, and several classes exist
--     only at PRODUCT level (influenza vaccines: J07BB; Tdap: J07AJ, where the
--     ingredients say only "diphtheria" and "tetanus"; oral iron B03AA versus
--     a prenatal vitamin that contains iron, B03AE / A11*).
--
-- New columns, all nullable:
--
--   ingredient_rxcuis    every ingredient (TTY=IN) RxCUI, RxNav order
--   ingredient_names     their names, index-aligned
--   product_rxcui        the RxCUI the input resolved to before reduction to ingredients
--   product_tty          its term type (SCD, SBD, BN, IN, …)
--   product_atc_classes  ATC level 1–4 classes of that concept (RxClass relaSource ATCPROD)
--
-- `ingredient_rxcui`, `ingredient_name` and `atc_classes` are untouched and
-- keep their meaning (the first ingredient and its classes): the drug-safety
-- checks read exactly those and behave exactly as before.
--
-- A row normalised before this migration has `ingredient_rxcuis IS NULL` while
-- `ingredient_rxcui` is set. The service treats such a row as not yet
-- classified — never as "contains only its first ingredient" — and re-resolves
-- it the next time the medication is seen. Rows cached as unmappable
-- (`ingredient_rxcui IS NULL`) are unchanged.
--
-- Additive. No session data is touched.

BEGIN;

ALTER TABLE medication_normalization_cache
  ADD COLUMN IF NOT EXISTS ingredient_rxcuis   TEXT[],
  ADD COLUMN IF NOT EXISTS ingredient_names    TEXT[],
  ADD COLUMN IF NOT EXISTS product_rxcui       TEXT,
  ADD COLUMN IF NOT EXISTS product_tty         TEXT,
  ADD COLUMN IF NOT EXISTS product_atc_classes TEXT[];

-- "Which cached medications contain ingredient X" — the admin queue's question
-- once gates match on ingredients.
CREATE INDEX IF NOT EXISTS idx_medication_normalization_cache_ingredients
  ON medication_normalization_cache USING GIN (ingredient_rxcuis);

COMMIT;
