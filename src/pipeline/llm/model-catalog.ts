import { ApiProvider } from '@/generated/prisma/enums';

export interface ModelEntry {
  id: string;
  name: string;
  provider: ApiProvider;
  description: string;
}

export const DEFAULT_MODEL_ID = 'gemini-2.0-flash';

export const MODEL_CATALOG: ModelEntry[] = [
  // Google
  {
    id: 'gemini-2.5-pro-preview-06-05',
    name: 'Gemini 2.5 Pro',
    provider: ApiProvider.google,
    description: 'Most capable, best reasoning',
  },
  {
    id: 'gemini-2.5-flash-preview-05-20',
    name: 'Gemini 2.5 Flash',
    provider: ApiProvider.google,
    description: 'Fast with strong reasoning',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: ApiProvider.google,
    description: 'Fast, cost-efficient (default)',
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: ApiProvider.google,
    description: 'Large context, reliable',
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: ApiProvider.google,
    description: 'Lightweight',
  },
  // OpenAI
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: ApiProvider.openai,
    description: 'Most capable',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: ApiProvider.openai,
    description: 'Fast & affordable',
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: ApiProvider.openai,
    description: 'Reasoning model',
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    provider: ApiProvider.openai,
    description: 'Reasoning model',
  },
];
// Ollama models are discovered dynamically from the user's server — they are not in this catalog.

export const findModel = (id: string): ModelEntry | undefined =>
  MODEL_CATALOG.find((m) => m.id === id);

export const defaultModelForProvider = (provider: ApiProvider): string =>
  MODEL_CATALOG.find((m) => m.provider === provider)?.id ?? DEFAULT_MODEL_ID;
