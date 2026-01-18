-- Add vector embeddings for care plans (training examples)
-- Enables semantic search for similar care plans based on diagnosis and content

-- Add embedding column to care_plans for training examples
ALTER TABLE care_plans
ADD COLUMN IF NOT EXISTS embedding vector(768);

ALTER TABLE care_plans
ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE;

-- Create IVFFlat index for fast approximate nearest neighbor search
-- Only indexes training examples since those are used for ML
CREATE INDEX IF NOT EXISTS idx_care_plans_embedding
ON care_plans USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 50)
WHERE is_training_example = true;

-- Function to find similar training care plans by embedding
CREATE OR REPLACE FUNCTION find_similar_training_plans(
    query_embedding vector(768),
    condition_codes_filter TEXT[] DEFAULT NULL,
    similarity_threshold FLOAT DEFAULT 0.6,
    max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
    care_plan_id UUID,
    title VARCHAR(500),
    condition_codes TEXT[],
    training_tags TEXT[],
    training_description TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cp.id as care_plan_id,
        cp.title,
        cp.condition_codes,
        cp.training_tags,
        cp.training_description,
        1 - (cp.embedding <=> query_embedding) as similarity
    FROM care_plans cp
    WHERE cp.is_training_example = true
      AND cp.embedding IS NOT NULL
      AND 1 - (cp.embedding <=> query_embedding) >= similarity_threshold
      AND (condition_codes_filter IS NULL OR cp.condition_codes && condition_codes_filter)
    ORDER BY cp.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Function to find care plans by condition codes with optional embedding ranking
CREATE OR REPLACE FUNCTION find_training_plans_by_conditions(
    condition_codes_filter TEXT[],
    query_embedding vector(768) DEFAULT NULL,
    max_results INTEGER DEFAULT 20
)
RETURNS TABLE (
    care_plan_id UUID,
    title VARCHAR(500),
    condition_codes TEXT[],
    training_tags TEXT[],
    condition_overlap INTEGER,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cp.id as care_plan_id,
        cp.title,
        cp.condition_codes,
        cp.training_tags,
        array_length(
            ARRAY(SELECT unnest(cp.condition_codes) INTERSECT SELECT unnest(condition_codes_filter)),
            1
        ) as condition_overlap,
        CASE
            WHEN query_embedding IS NOT NULL AND cp.embedding IS NOT NULL
            THEN 1 - (cp.embedding <=> query_embedding)
            ELSE 0.0
        END as similarity
    FROM care_plans cp
    WHERE cp.is_training_example = true
      AND cp.condition_codes && condition_codes_filter
    ORDER BY
        condition_overlap DESC,
        similarity DESC
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the embedding
COMMENT ON COLUMN care_plans.embedding IS 'Vector embedding (768 dimensions) from sentence-transformers/all-mpnet-base-v2 for semantic similarity search';
