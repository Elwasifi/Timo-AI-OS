// Embeddings Edge Function — generates text embeddings via multiple providers.
// Provider is configurable: Gemini, OpenRouter, NVIDIA, Ollama, OpenAI.
// API keys are read from app_settings (the single source of truth).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmbedRequest {
  action: "embed" | "embed_batch";
  text?: string;
  texts?: string[];
  provider?: string;
  model?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as EmbedRequest;
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase credentials.");
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Load settings for API keys
    const { data: settingsData } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
    const settings = settingsData ?? {};

    const provider = body.provider ?? "gemini";
    const model = body.model ?? getDefaultModel(provider);

    let texts: string[];
    if (body.action === "embed") {
      texts = [body.text ?? ""];
    } else {
      texts = body.texts ?? [];
    }
    if (texts.length === 0) throw new Error("No text provided for embedding.");

    const embeddings: number[][] = [];
    for (const text of texts) {
      const vec = await generateEmbedding(provider, model, text, settings);
      embeddings.push(vec);
    }

    return new Response(
      JSON.stringify({
        embedding: embeddings[0],
        embeddings,
        provider,
        model,
        dimensions: embeddings[0]?.length ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    gemini: "gemini-embedding-001",
    openrouter: "openai/text-embedding-3-small",
    nvidia: "nvidia/nv-embed-v1",
    ollama: "nomic-embed-text",
    openai: "text-embedding-3-small",
  };
  return defaults[provider] ?? "gemini-embedding-001";
}

async function generateEmbedding(provider: string, model: string, text: string, settings: Record<string, unknown>): Promise<number[]> {
  switch (provider) {
    case "gemini":
      return geminiEmbed(text, model, settings.gemini_api_key as string);
    case "openrouter":
      return openaiCompatEmbed(`https://openrouter.ai/api/v1/embeddings`, text, model, settings.openrouter_api_key as string);
    case "nvidia":
      return openaiCompatEmbed(`https://integrate.api.nvidia.com/v1/embeddings`, text, model, settings.nvidia_api_key as string);
    case "ollama":
      return ollamaEmbed(text, model, settings.ollama_base_url as string);
    case "openai":
      return openaiCompatEmbed(`https://api.openai.com/v1/embeddings`, text, model, (settings as Record<string, unknown>).openai_api_key as string);
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

async function geminiEmbed(text: string, model: string, apiKey: string): Promise<number[]> {
  if (!apiKey) throw new Error("Gemini API key not configured for embeddings.");
  // Gemini expects the model without the "models/" prefix in the URL path
  const cleanModel = model.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${cleanModel}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embedding failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.embedding?.values ?? [];
}

async function openaiCompatEmbed(url: string, text: string, model: string, apiKey: string): Promise<number[]> {
  if (!apiKey) throw new Error(`API key not configured for embedding provider.`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.data?.[0]?.embedding ?? [];
}

async function ollamaEmbed(text: string, model: string, baseUrl: string): Promise<number[]> {
  const base = (baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama embedding failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.embedding ?? [];
}
