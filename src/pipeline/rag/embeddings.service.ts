import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { ApiProvider } from '@/generated/prisma/enums';
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_PROVIDER,
} from './embedding-catalog';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly googleApiKey: string;
  private readonly openaiApiKey: string | undefined;

  constructor(config: ConfigService) {
    this.googleApiKey = config.getOrThrow('GOOGLE_API_KEY');
    this.openaiApiKey = config.get<string>('OPENAI_API_KEY');
  }

  async createEmbedding(
    text: string,
    provider: ApiProvider = DEFAULT_EMBEDDING_PROVIDER,
    model: string = DEFAULT_EMBEDDING_MODEL,
    apiKey?: string,
  ): Promise<number[]> {
    const truncated = text.slice(0, 8000);
    switch (provider) {
      case ApiProvider.google:
        return this.embedGoogle(truncated, model, apiKey ?? this.googleApiKey);
      case ApiProvider.openai:
        return this.embedOpenAI(truncated, model, apiKey ?? this.openaiApiKey ?? '');
      case ApiProvider.ollama:
        return this.embedOllama(truncated, model, apiKey);
      default:
        this.logger.warn(`Unknown embedding provider "${String(provider)}", falling back to Google`);
        return this.embedGoogle(truncated, DEFAULT_EMBEDDING_MODEL, this.googleApiKey);
    }
  }

  private async embedGoogle(text: string, model: string, apiKey: string): Promise<number[]> {
    const ai = new GoogleGenerativeAI(apiKey);
    const m = ai.getGenerativeModel({ model });
    const result = await m.embedContent(text);
    const embedding = result.embedding.values;
    if (!Array.isArray(embedding)) throw new Error('Embedding response is not an array');
    return embedding;
  }

  private async embedOpenAI(text: string, model: string, apiKey: string): Promise<number[]> {
    const client = new OpenAI({ apiKey });
    const result = await client.embeddings.create({ model, input: text });
    const embedding = result.data[0]?.embedding;
    if (!embedding) throw new Error('No embedding returned from OpenAI');
    return embedding;
  }

  private async embedOllama(text: string, model: string, baseUrl?: string): Promise<number[]> {
    const resolvedBase = (baseUrl?.trim() || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
    const res = await fetch(`${resolvedBase}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Ollama embeddings returned ${res.status}`);
    const data = (await res.json()) as { embedding: number[] };
    if (!Array.isArray(data.embedding)) throw new Error('Ollama embedding response is not an array');
    return data.embedding;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}
