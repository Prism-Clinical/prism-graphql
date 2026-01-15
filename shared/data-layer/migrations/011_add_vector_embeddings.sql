-- Add vector embeddings for semantic search in RAG service
-- Requires pgvector extension to be installed in PostgreSQL

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to guidelines table for semantic search
ALTER TABLE guidelines
ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Create IVFFlat index for fast approximate nearest neighbor search
-- Using cosine similarity (vector_cosine_ops) for normalized embeddings
-- lists = 100 is a good default for up to ~100k vectors
CREATE INDEX IF NOT EXISTS idx_guidelines_embedding
ON guidelines USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Add embedding column to care plan templates for similarity matching
ALTER TABLE care_plan_templates
ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Create index for template embeddings
CREATE INDEX IF NOT EXISTS idx_templates_embedding
ON care_plan_templates USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 50);

-- Add embedding status tracking to know which records need embedding
ALTER TABLE guidelines
ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE care_plan_templates
ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE;

-- Create a function to find similar guidelines by embedding
CREATE OR REPLACE FUNCTION find_similar_guidelines(
    query_embedding vector(768),
    similarity_threshold FLOAT DEFAULT 0.7,
    max_results INTEGER DEFAULT 20
)
RETURNS TABLE (
    guideline_id UUID,
    title VARCHAR(500),
    category VARCHAR(20),
    evidence_grade VARCHAR(5),
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        g.id as guideline_id,
        g.title,
        g.category,
        g.evidence_grade,
        1 - (g.embedding <=> query_embedding) as similarity
    FROM guidelines g
    WHERE g.embedding IS NOT NULL
      AND 1 - (g.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY g.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Create a function to find similar care plan templates
CREATE OR REPLACE FUNCTION find_similar_templates(
    query_embedding vector(768),
    similarity_threshold FLOAT DEFAULT 0.7,
    max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
    template_id UUID,
    name VARCHAR(200),
    category VARCHAR(30),
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id as template_id,
        t.name,
        t.category,
        1 - (t.embedding <=> query_embedding) as similarity
    FROM care_plan_templates t
    WHERE t.embedding IS NOT NULL
      AND 1 - (t.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY t.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the embedding dimension
COMMENT ON COLUMN guidelines.embedding IS 'Vector embedding (768 dimensions) from sentence-transformers/all-mpnet-base-v2 for semantic search';
COMMENT ON COLUMN care_plan_templates.embedding IS 'Vector embedding (768 dimensions) for template similarity matching';
