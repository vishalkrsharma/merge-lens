import { ApiProvider } from '@/generated/prisma/enums';

export interface EmbeddingModelEntry {
  id: string;
  name: string;
  provider: ApiProvider;
  dimensions: number;
  description: string;
}

// Anthropic has no embedding API — excluded entirely.
export const EMBEDDING_CATALOG: EmbeddingModelEntry[] = [
  // Google
  {
    id: 'gemini-embedding-2',
    name: 'Gemini Embedding 2',
    provider: ApiProvider.google,
    dimensions: 3072,
    description: 'Latest, highest quality (default)',
  },
  {
    id: 'text-embedding-004',
    name: 'Text Embedding 004',
    provider: ApiProvider.google,
    dimensions: 768,
    description: 'Compact, efficient',
  },
  // OpenAI
  {
    id: 'text-embedding-3-large',
    name: 'text-embedding-3-large',
    provider: ApiProvider.openai,
    dimensions: 3072,
    description: 'Highest quality',
  },
  {
    id: 'text-embedding-3-small',
    name: 'text-embedding-3-small',
    provider: ApiProvider.openai,
    dimensions: 1536,
    description: 'Fast & affordable (recommended)',
  },
  {
    id: 'text-embedding-ada-002',
    name: 'text-embedding-ada-002',
    provider: ApiProvider.openai,
    dimensions: 1536,
    description: 'Legacy',
  },
  // Ollama — dynamic; common embedding models listed for reference.
  // The UI fetches available models from the Ollama server directly.
];

export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2';
export const DEFAULT_EMBEDDING_PROVIDER = ApiProvider.google;

export const EMBEDDING_PROVIDERS = [
  ApiProvider.google,
  ApiProvider.openai,
  ApiProvider.ollama,
] as const;

export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export const findEmbeddingModel = (id: string) =>
  EMBEDDING_CATALOG.find((m) => m.id === id);
