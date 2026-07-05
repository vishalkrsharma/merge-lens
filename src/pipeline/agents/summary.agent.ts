import { Injectable, Logger } from '@nestjs/common';
import { ApiProvider } from '@/generated/prisma/enums';
import { LlmService } from '@/pipeline/llm/llm.service';
import { DEFAULT_PROMPTS } from './prompts';
import { AgentResponse, ReviewContext } from './types';

@Injectable()
export class SummaryAgent {
  private readonly logger = new Logger(SummaryAgent.name);

  constructor(private readonly llm: LlmService) {}

  async summarize(
    context: ReviewContext,
    results: {
      bug: AgentResponse;
      security: AgentResponse;
      performance: AgentResponse;
      style: AgentResponse;
    },
    provider: ApiProvider,
    apiKey: string,
    modelId: string,
    customPrompt?: string,
  ): Promise<string> {
    const totalFindings =
      results.bug.findings.length +
      results.security.findings.length +
      results.performance.findings.length +
      results.style.findings.length;

    const highFindings = [
      ...results.bug.findings,
      ...results.security.findings,
      ...results.performance.findings,
      ...results.style.findings,
    ].filter((f) => f.severity === 'high').length;

    const instruction = customPrompt ?? DEFAULT_PROMPTS.summary;
    const prompt = `${instruction}

PR: ${context.title}
Description: ${context.description}

Agent summaries:
- Bug Analysis: ${results.bug.summary}
- Security Analysis: ${results.security.summary}
- Performance Analysis: ${results.performance.summary}
- Style Analysis: ${results.style.summary}

Total findings: ${totalFindings} (${highFindings} high severity)`;

    try {
      const text = await this.llm.generate(prompt, provider, apiKey, modelId);
      return (
        text.trim() ||
        `PR review complete. Found ${totalFindings} issues (${highFindings} high severity).`
      );
    } catch (err) {
      this.logger.warn(`SummaryAgent failed: ${String(err)}`);
      return `PR review complete. Found ${totalFindings} issues (${highFindings} high severity).`;
    }
  }
}
