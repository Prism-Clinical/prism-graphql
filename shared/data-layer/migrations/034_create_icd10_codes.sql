-- ICD-10-CM reference table for code search
-- Source: CMS ICD-10-CM code set (public domain)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS icd10_codes (
    code        VARCHAR(10) PRIMARY KEY,
    description TEXT NOT NULL,
    category    VARCHAR(10) NOT NULL,
    category_description TEXT NOT NULL,
    is_billable BOOLEAN NOT NULL DEFAULT true
);

-- Trigram indexes for fast text search
CREATE INDEX IF NOT EXISTS idx_icd10_code_trgm
    ON icd10_codes USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_icd10_desc_trgm
    ON icd10_codes USING gin (description gin_trgm_ops);

-- Standard B-tree index on category for grouping
CREATE INDEX IF NOT EXISTS idx_icd10_category
    ON icd10_codes (category);
