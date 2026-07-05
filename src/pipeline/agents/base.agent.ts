import { Logger } from '@nestjs/common';
import { ApiProvider } from '@/generated/prisma/enums';
import { LlmService } from '@/pipeline/llm/llm.service';
import { AgentResponse, ReviewContext } from './types';

export abstract class BaseAgent {
  protected abstract readonly logger: Logger;

  constructor(protected readonly llm: LlmService) {}

  protected async generate(
    prompt: string,
    provider: ApiProvider,
    apiKey: string,
    modelId: string,
  ): Promise<AgentResponse> {
    const raw = await this.llm.generate(prompt, provider, apiKey, modelId);
    if (!raw)
      return { findings: [], summary: 'Agent failed to produce results' };

    try {
      // Strip code fences, then fall back to extracting the first {...} block
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonStr = fenced
        ? fenced[1]
        : (raw.match(/(\{[\s\S]*\})/)?.[1] ?? raw);
      return JSON.parse(jsonStr.trim()) as AgentResponse;
    } catch (err) {
      this.logger.warn(`Agent failed to parse response: ${String(err)}`);
      this.logger.debug(`Raw LLM response: ${raw.slice(0, 500)}`);
      return { findings: [], summary: 'Agent failed to produce results' };
    }
  }

  protected buildDocsSection(docs: string[]): string {
    if (docs.length === 0) return '';
    return `Repository Context:\n${docs.join('\n\n')}\n\n`;
  }

  protected buildReviewPrompt(
    instruction: string,
    context: ReviewContext,
    findingNoun: string,
  ): string {
    return `${this.buildDocsSection(context.docs)}${instruction}

PR Title: ${context.title}
PR Description: ${context.description}

Diff:
${context.diff}

Return ONLY valid JSON. No explanation, no markdown, no code fences.

STRICT RULES — violating any of these makes the response unusable:
- "file": file path only, e.g. "src/foo.ts" — never include line ranges like "src/foo.ts:10-20"
- "line": a single positive integer that exists in the diff above — never null, never undefined, never a range string
- "severity": must be exactly one of the three strings: "low", "medium", "high" — never "medium-high" or any other value
- "issue": a non-empty string describing the ${findingNoun}
- "suggestion": a non-empty string explaining how to fix it
- If you cannot determine a valid integer line number for a finding, omit that finding entirely
- All six fields are required on every finding — never omit or set to null/undefined

{
  "findings": [
    {
      "file": "src/example.ts",
      "line": 42,
      "severity": "high",
      "issue": "description of the ${findingNoun}",
      "suggestion": "how to fix it"
    }
  ],
  "summary": "brief summary of the analysis"
}`;
  }
}
