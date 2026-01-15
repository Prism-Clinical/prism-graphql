-- Migration: Add training example support for care plans
-- Purpose: Allow care plans to be created without patients for RAG/ML training

-- =============================================================================
-- 1. Add training example columns to care_plans
-- =============================================================================

-- Add is_training_example flag
ALTER TABLE care_plans
  ADD COLUMN IF NOT EXISTS is_training_example BOOLEAN NOT NULL DEFAULT false;

-- Add training description for RAG context
ALTER TABLE care_plans
  ADD COLUMN IF NOT EXISTS training_description TEXT;

-- Add training tags for categorization
ALTER TABLE care_plans
  ADD COLUMN IF NOT EXISTS training_tags TEXT[] DEFAULT '{}';

-- =============================================================================
-- 2. Make patient_id nullable for training examples
-- =============================================================================

-- Drop the existing foreign key constraint
ALTER TABLE care_plans
  DROP CONSTRAINT IF EXISTS care_plans_patient_id_fkey;

-- Make patient_id nullable
ALTER TABLE care_plans
  ALTER COLUMN patient_id DROP NOT NULL;

-- Make created_by nullable (training examples may not have a user context)
ALTER TABLE care_plans
  ALTER COLUMN created_by DROP NOT NULL;

-- Add check constraint: patient_id required unless training example
ALTER TABLE care_plans
  ADD CONSTRAINT care_plans_patient_or_training
  CHECK (patient_id IS NOT NULL OR is_training_example = true);

-- Re-add foreign key constraint (only enforced when patient_id is not null)
-- PostgreSQL allows FK on nullable columns - constraint only checked when value is not null
ALTER TABLE care_plans
  ADD CONSTRAINT care_plans_patient_id_fkey
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;

-- =============================================================================
-- 3. Add index for training examples
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_care_plans_training
  ON care_plans(is_training_example)
  WHERE is_training_example = true;

CREATE INDEX IF NOT EXISTS idx_care_plans_training_tags
  ON care_plans USING GIN(training_tags)
  WHERE is_training_example = true;

-- =============================================================================
-- 4. Add description and created_by to care_plan_templates
-- =============================================================================

ALTER TABLE care_plan_templates
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE care_plan_templates
  ADD COLUMN IF NOT EXISTS created_by UUID;
