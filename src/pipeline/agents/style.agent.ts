import { Injectable, Logger } from '@nestjs/common';
import { ApiProvider } from '@/generated/prisma/enums';
import { LlmService } from '@/pipeline/llm/llm.service';
import { BaseAgent } from './base.agent';
import { DEFAULT_PROMPTS } from './prompts';
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
    customPrompt?: string,
  ): Promise<AgentResponse> {
    const instruction = customPrompt ?? DEFAULT_PROMPTS.style;
    const prompt = `${this.buildDocsSection(context.docs)}${instruction}

PR Title: ${context.title}
PR Description: ${context.description}

Diff:
${context.diff}

Return ONLY valid JSON. No explanation, no markdown, no code fences.

STRICT RULES — violating any of these makes the response unusable:
- "file": file path only, e.g. "src/foo.ts" — never include line ranges like "src/foo.ts:10-20"
- "line": a single positive integer that exists in the diff above — never null, never undefined, never a range string
- "severity": must be exactly one of the three strings: "low", "medium", "high" — never "medium-high" or any other value
- "issue": a non-empty string describing the style issue
- "suggestion": a non-empty string explaining how to improve it
- If you cannot determine a valid integer line number for a finding, omit that finding entirely
- All six fields are required on every finding — never omit or set to null/undefined

{
  "findings": [
    {
      "file": "src/example.ts",
      "line": 42,
      "severity": "low",
      "issue": "description of the style issue",
      "suggestion": "how to improve it"
    }
  ],
  "summary": "brief summary of code quality analysis"
}`;

    return this.generate(prompt, provider, apiKey, modelId);
  }
}
