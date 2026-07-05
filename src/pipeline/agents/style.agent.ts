import { Injectable, Logger } from '@nestjs/common';
import { ApiProvider } from '@/generated/prisma/enums';
import { LlmService } from '@/pipeline/llm/llm.service';
import { BaseAgent } from './base.agent';
import { DEFAULT_AGENT_PROMPTS } from './default-prompts';
import { AgentResponse, ReviewContext } from './types';

@Injectable()
export class StyleAgent extends BaseAgent {
  protected readonly logger = new Logger(StyleAgent.name);

  constructor(llm: LlmService) {
    super(llm);
  }

  async review(
    context: ReviewContext,
    provider: ApiProvider,
    apiKey: string,
    modelId: string,
    instruction?: string,
  ): Promise<AgentResponse> {
    const prompt = this.buildReviewPrompt(
      instruction ?? DEFAULT_AGENT_PROMPTS.style,
      context,
      'style issue',
    );
    return this.generate(prompt, provider, apiKey, modelId);
  }
}
