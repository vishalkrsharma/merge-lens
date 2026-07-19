import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { ApiProvider } from '@/generated/prisma/enums';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor() {}

  async generate(
    prompt: string,
    provider: ApiProvider,
    apiKey: string,
    modelId: string,
  ): Promise<string> {
    switch (provider) {
      case ApiProvider.google:
        return await this.generateGoogle(prompt, apiKey, modelId);
      case ApiProvider.openai:
        return await this.generateOpenAI(prompt, apiKey, modelId);
      case ApiProvider.ollama:
        return await this.generateOllama(prompt, apiKey, modelId);
      default:
        throw new Error(`Unsupported provider: ${String(provider)}`);
    }
  }

  private async generateGoogle(
    prompt: string,
    apiKey: string,
    modelId: string,
  ): Promise<string> {
    const ai = new GoogleGenerativeAI(apiKey);
    const model = ai.getGenerativeModel({ model: modelId });
    const result = await model.generateContent(prompt);
    return result.response.text() ?? '';
  }

  private async generateOpenAI(
    prompt: string,
    apiKey: string,
    modelId: string,
  ): Promise<string> {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
    });
    return completion.choices[0]?.message.content ?? '';
  }

  private async generateOllama(
    prompt: string,
    baseUrl: string,
    modelId: string,
  ): Promise<string> {
    const resolvedBase = baseUrl.trim() || OLLAMA_BASE_URL;
    // Use streaming so tokens flow back continuously — Ollama's 5-minute server-side
    // timeout only fires when the connection is idle, not while tokens are being generated.
    const client = new OpenAI({
      baseURL: `${resolvedBase}/v1`,
      apiKey: 'ollama',
      timeout: 30 * 60 * 1000,
    });
    const stream = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    });
    let result = '';
    for await (const chunk of stream) {
      result += chunk.choices[0]?.delta?.content ?? '';
    }
    return result;
  }
}
