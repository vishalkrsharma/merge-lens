import { Injectable, Logger } from '@nestjs/common';
import { ApiProvider, AgentType } from '@/generated/prisma/enums';
import { BugAgent } from '@/pipeline/agents/bug.agent';
import { SecurityAgent } from '@/pipeline/agents/security.agent';
import { PerformanceAgent } from '@/pipeline/agents/performance.agent';
import { StyleAgent } from '@/pipeline/agents/style.agent';
import { SummaryAgent } from '@/pipeline/agents/summary.agent';
import {
  AgentPrompts,
  AgentResponse,
  OrchestratorResult,
  ReviewContext,
} from '@/pipeline/agents/types';
import { MetricsService } from '@/core/observability/metrics.service';
import { TracingService } from '@/core/observability/tracing.service';
import {
  DEFAULT_MODEL_ID,
  defaultModelForProvider,
  findModel,
} from '@/pipeline/llm/model-catalog';

const DISABLED_AGENT: AgentResponse = { findings: [], summary: '' };

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly bugAgent: BugAgent,
    private readonly securityAgent: SecurityAgent,
    private readonly performanceAgent: PerformanceAgent,
    private readonly styleAgent: StyleAgent,
    private readonly summaryAgent: SummaryAgent,
    private readonly metrics: MetricsService,
    private readonly tracing: TracingService,
  ) {}

  async execute(
    context: ReviewContext,
    enabledAgents: AgentType[] = [],
    apiKeys: Partial<Record<ApiProvider, string>> = {},
    preferredProvider?: ApiProvider | null,
    preferredModel?: string | null,
    ollamaBaseUrl?: string | null,
    agentPrompts?: Partial<AgentPrompts>,
  ): Promise<OrchestratorResult> {
    const span = this.tracing.startSpan('orchestrator.execute');

    const active =
      enabledAgents.length === 0
        ? (['bug', 'security', 'performance', 'style'] as AgentType[])
        : enabledAgents;

    const { provider, apiKey, modelId } = this.resolveModel(
      apiKeys,
      preferredProvider,
      preferredModel,
      ollamaBaseUrl,
    );

    this.logger.log(
      `Starting review with agents: ${active.join(', ')} using provider: ${String(provider)}, model: ${modelId}`,
    );

    const agentStart = Date.now();

    const run = (name: AgentType, fn: () => Promise<AgentResponse>) =>
      active.includes(name)
        ? this.runAgent(name, fn)
        : Promise.resolve(DISABLED_AGENT);

    // Ollama has a single inference slot — run sequentially so requests don't
    // queue up and all die together when one hits the SDK timeout.
    let bug: AgentResponse;
    let security: AgentResponse;
    let performance: AgentResponse;
    let style: AgentResponse;

    if (provider === ApiProvider.ollama) {
      bug = await run('bug', () =>
        this.bugAgent.review(context, provider, apiKey, modelId, agentPrompts?.bug),
      );
      security = await run('security', () =>
        this.securityAgent.review(context, provider, apiKey, modelId, agentPrompts?.security),
      );
      performance = await run('performance', () =>
        this.performanceAgent.review(context, provider, apiKey, modelId, agentPrompts?.performance),
      );
      style = await run('style', () =>
        this.styleAgent.review(context, provider, apiKey, modelId, agentPrompts?.style),
      );
    } else {
      [bug, security, performance, style] = await Promise.all([
        run('bug', () =>
          this.bugAgent.review(context, provider, apiKey, modelId, agentPrompts?.bug),
        ),
        run('security', () =>
          this.securityAgent.review(context, provider, apiKey, modelId, agentPrompts?.security),
        ),
        run('performance', () =>
          this.performanceAgent.review(context, provider, apiKey, modelId, agentPrompts?.performance),
        ),
        run('style', () =>
          this.styleAgent.review(context, provider, apiKey, modelId, agentPrompts?.style),
        ),
      ]);
    }

    const agentDuration = Date.now() - agentStart;
    this.logger.log(`All agents completed in ${agentDuration}ms`);
    this.metrics.recordAgentDuration('all_agents', agentDuration);

    const summaryStart = Date.now();
    const overallSummary = await this.summaryAgent.summarize(
      context,
      { bug, security, performance, style },
      provider,
      apiKey,
      modelId,
      agentPrompts?.summary,
    );
    this.metrics.recordAgentDuration(
      'summary_agent',
      Date.now() - summaryStart,
    );

    span.end();
    return { bug, security, performance, style, overallSummary };
  }

  private resolveModel(
    apiKeys: Partial<Record<ApiProvider, string>>,
    preferredProvider?: ApiProvider | null,
    preferredModel?: string | null,
    ollamaBaseUrl?: string | null,
  ): { provider: ApiProvider; apiKey: string; modelId: string } {
    const ollamaUrl = ollamaBaseUrl ?? '';

    // If a specific model is set, derive the provider from the catalog.
    // Dynamic Ollama models (not in catalog) are identified by the ollama preferredProvider fallback.
    if (preferredModel) {
      const entry = findModel(preferredModel);
      if (entry) {
        // For Ollama, apiKey carries the base URL (empty = use env/default)
        if (entry.provider === ApiProvider.ollama) {
          return {
            provider: ApiProvider.ollama,
            apiKey: ollamaUrl,
            modelId: preferredModel,
          };
        }
        const userKey = apiKeys[entry.provider];
        if (userKey)
          return {
            provider: entry.provider,
            apiKey: userKey,
            modelId: preferredModel,
          };
      } else if (preferredProvider === ApiProvider.ollama) {
        // Dynamic model not in catalog but provider is ollama
        return {
          provider: ApiProvider.ollama,
          apiKey: ollamaUrl,
          modelId: preferredModel,
        };
      }
    }

    // Fall back to provider preference (legacy)
    const target = preferredProvider ?? ApiProvider.google;
    if (target === ApiProvider.ollama) {
      return {
        provider: ApiProvider.ollama,
        apiKey: ollamaUrl,
        modelId: defaultModelForProvider(ApiProvider.ollama),
      };
    }
    const userKey = apiKeys[target];
    if (userKey) {
      return {
        provider: target,
        apiKey: userKey,
        modelId: defaultModelForProvider(target),
      };
    }

    throw new Error(
      `No API key configured for provider "${String(preferredProvider ?? 'google')}". Add your key at Settings → AI Models.`,
    );
  }

  private async runAgent<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const span = this.tracing.startSpan(`agent.${name}`);
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.logger.log(`${name} agent completed in ${duration}ms`);
      this.metrics.recordAgentDuration(name, duration);
      return result;
    } finally {
      span.end();
    }
  }
}
