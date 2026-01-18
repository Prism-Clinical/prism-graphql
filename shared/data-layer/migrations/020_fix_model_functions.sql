-- Migration 020: Fix model training functions for new schema

CREATE OR REPLACE FUNCTION public.get_model_training_examples(p_model_id uuid)
 RETURNS TABLE(care_plan_id uuid, assignment_type character varying, title character varying, condition_codes text[], training_tags text[])
 LANGUAGE plpgsql
AS $$
DECLARE
    v_filter_criteria JSONB;
BEGIN
    -- Get model's filter criteria
    SELECT m.filter_criteria INTO v_filter_criteria
    FROM ml_models m
    WHERE m.id = p_model_id;

    -- Return combined manual assignments and filter matches
    RETURN QUERY
    WITH manual_assignments AS (
        -- Manual/import assignments from junction table
        SELECT
            mtd.care_plan_id,
            mtd.assignment_type
        FROM ml_model_training_data mtd
        WHERE mtd.model_id = p_model_id
    ),
    filter_matches AS (
        -- Auto-matched by filter criteria
        SELECT
            cp.id AS care_plan_id,
            'filter'::VARCHAR(20) AS assignment_type
        FROM care_plans cp
        WHERE cp.is_active = true
          AND p_model_id IS NOT NULL
          AND v_filter_criteria IS NOT NULL
          AND v_filter_criteria != '{}'::JSONB
          -- Match condition code prefixes
          AND (
              NOT v_filter_criteria ? 'condition_code_prefixes'
              OR EXISTS (
                  SELECT 1
                  FROM unnest(cp.condition_codes) AS cc,
                       jsonb_array_elements_text(v_filter_criteria->'condition_code_prefixes') AS prefix
                  WHERE cc LIKE prefix || '%'
              )
          )
          -- Match exact condition codes
          AND (
              NOT v_filter_criteria ? 'condition_codes'
              OR cp.condition_codes && ARRAY(
                  SELECT jsonb_array_elements_text(v_filter_criteria->'condition_codes')
              )
          )
          -- Exclude already manually assigned
          AND cp.id NOT IN (
              SELECT ma.care_plan_id FROM manual_assignments ma
          )
    ),
    combined AS (
        SELECT * FROM manual_assignments
        UNION ALL
        SELECT * FROM filter_matches
    )
    SELECT
        c.care_plan_id,
        c.assignment_type,
        cp.name::VARCHAR(255) as title,
        cp.condition_codes,
        '{}'::text[] as training_tags
    FROM combined c
    JOIN care_plans cp ON cp.id = c.care_plan_id
    WHERE cp.is_active = true;
END;
$$;
