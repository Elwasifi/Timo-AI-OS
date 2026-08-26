// Embedding Service — provider-agnostic text embedding generation.
// Supports Gemini, OpenRouter, NVIDIA, Ollama, and future providers.
// All embeddings are generated server-side via the embeddings edge function
// to keep API keys secure. This client module calls the edge function.

import { supabase } from '@/lib/supabase/client';
import type { EmbeddingResult, EmbeddingProvider } from './types';
import { loadMemorySettings } from './memorySettings';

const EMBEDDINGS_ENDPOINT = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embeddings`;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// memory_embeddings.embedding is a fixed vector(3072) column (see
// supabase/migrations/20260727112722_update_vector_dimension_3072.sql,
// sized for Gemini's gemini-embedding-001). pgvector enforces this at
// insert time and errors on any other width — but switching
// embedding_provider/embedding_model in Settings to a provider with a
// different native dimension (e.g. OpenRouter's text-embedding-3-small at
// 1536, Ollama's nomic-embed-text at 768) would otherwise surface as a raw,
// unexplained Postgres error on the next memory store. Catching it here
// gives a clear, actionable message instead.
const EXPECTED_EMBEDDING_DIMENSIONS = 3072;

export const embeddingService = {
  async embed(text: string, provider?: string, model?: string): Promise<EmbeddingResult> {
    const settings = await loadMemorySettings();
    const res = await fetch(EMBEDDINGS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        action: 'embed',
        text,
        provider: provider ?? settings.embedding_provider,
        model: model ?? settings.embedding_model,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Embedding failed (${res.status})` }));
      throw new Error(err.error ?? `Embedding failed (${res.status})`);
    }
    const data = await res.json();
    return {
      vector: data.embedding as number[],
      provider: data.provider as string,
      model: data.model as string,
      dimensions: data.dimensions as number,
    };
  },

  async embedBatch(texts: string[], provider?: string, model?: string): Promise<EmbeddingResult[]> {
    const settings = await loadMemorySettings();
    const res = await fetch(EMBEDDINGS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        action: 'embed_batch',
        texts,
        provider: provider ?? settings.embedding_provider,
        model: model ?? settings.embedding_model,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Batch embedding failed (${res.status})` }));
      throw new Error(err.error ?? `Batch embedding failed (${res.status})`);
    }
    const data = await res.json();
    return (data.embeddings as number[][]).map((vector, i) => ({
      vector,
      provider: data.provider as string,
      model: data.model as string,
      dimensions: data.dimensions as number,
    }));
  },

  async storeEmbedding(memoryId: string, text: string, provider?: string, model?: string): Promise<void> {
    const settings = await loadMemorySettings();
    const result = await this.embed(text, provider, model);
    if (result.dimensions !== EXPECTED_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding model "${result.model}" (${result.provider}) produced a ${result.dimensions}-dimension vector, ` +
        `but memory_embeddings is fixed at ${EXPECTED_EMBEDDING_DIMENSIONS} dimensions (sized for Gemini's ` +
        `gemini-embedding-001). Switch back to a ${EXPECTED_EMBEDDING_DIMENSIONS}-dimension embedding model in ` +
        `Settings, or this memory cannot be semantically indexed.`,
      );
    }
    const { error } = await supabase.from('memory_embeddings').insert({
      memory_id: memoryId,
      embedding: result.vector,
      model: result.model,
      provider: result.provider,
      chunk_index: 0,
      chunk_text: text.slice(0, 1000),
    });
    if (error) throw new Error(`Failed to store embedding: ${error.message}`);
  },

  async getProviders(): Promise<Array<{ id: EmbeddingProvider; label: string; models: string[] }>> {
    return [
      { id: 'gemini', label: 'Google Gemini', models: ['gemini-embedding-001', 'gemini-embedding-2-preview', 'gemini-embedding-2'] },
      { id: 'openrouter', label: 'OpenRouter', models: ['openai/text-embedding-3-small', 'openai/text-embedding-3-large'] },
      { id: 'nvidia', label: 'NVIDIA NIM', models: ['nvidia/nv-embed-v1', 'nvidia/llama-3.2-nv-embedqa-1b-v2'] },
      { id: 'ollama', label: 'Ollama (Local)', models: ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large'] },
      { id: 'openai', label: 'OpenAI', models: ['text-embedding-3-small', 'text-embedding-3-large'] },
    ];
  },
};
