import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { randomUUID } from 'crypto';
import { ReviewContext } from '@/pipeline/agents/types';
import { CommentsService } from '@/integrations/comments/comments.service';
import { GithubService } from '@/integrations/github/github.service';
import { LoggerService } from '@/core/observability/logger.service';
import { MetricsService } from '@/core/observability/metrics.service';
import { TracingService } from '@/core/observability/tracing.service';
import { OrchestratorService } from '@/pipeline/orchestrator/orchestrator.service';
import { PrismaService } from '@/core/prisma/prisma.service';
import { PG_BOSS } from '@/core/queue/queue.constants';
import { REVIEW_QUEUE, ReviewJobData } from '@/core/queue/queue.constants';
import { RetrievalService } from '@/pipeline/rag/retrieval.service';
import { AgentType, Severity } from '@/generated/prisma/enums';
import { ApiKeysService } from '@/modules/settings/api-keys.service';
import { RealtimeService } from '@/core/realtime/realtime.service';

const AGENT_TYPES: AgentType[] = ['bug', 'security', 'performance', 'style'];

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };
const meetsThreshold = (severity: string, threshold: Severity) =>
  (SEVERITY_RANK[severity as Severity] ?? 0) >= SEVERITY_RANK[threshold];

@Injectable()
export class ReviewProcessor implements OnModuleInit {
  private readonly logger = new Logger(ReviewProcessor.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly githubService: GithubService,
    private readonly orchestrator: OrchestratorService,
    private readonly commentsService: CommentsService,
    private readonly retrieval: RetrievalService,
    private readonly prisma: PrismaService,
    private readonly appLogger: LoggerService,
    private readonly metrics: MetricsService,
    private readonly tracing: TracingService,
    private readonly apiKeysService: ApiKeysService,
    private readonly realtime: RealtimeService,
  ) {}

  async onModuleInit() {
    await this.boss.work<ReviewJobData>(REVIEW_QUEUE, (jobs) =>
      Promise.all(jobs.map((job) => this.process(job))),
    );
  }

  async process(job: PgBoss.Job<ReviewJobData>): Promise<void> {
    const {
      repo,
      owner,
      pullNumber,
      repositoryId,
      installationId,
      enabledAgents,
      severityThreshold,
    } = job.data;
    const reviewStart = Date.now();
    const span = this.tracing.startSpan('review.process');
    const reviewId = job.data.reviewId ?? randomUUID();

    this.appLogger.webhookReceived(owner, repo, pullNumber);
    this.logger.log(`Processing PR ${owner}/${repo}#${pullNumber}`);

    const startCommentId = await this.commentsService.postStartComment(
      owner,
      repo,
      pullNumber,
      installationId,
    );

    let repository: { userId: string } | null = null;

    try {
      this.appLogger.fetchingPR(owner, repo, pullNumber);

      const [prDetails, commitId, files] = await Promise.all([
        this.githubService.getPRDetails(
          owner,
          repo,
          pullNumber,
          installationId,
        ),
        this.githubService.getHeadSha(owner, repo, pullNumber, installationId),
        this.githubService.getChangedFiles(
          owner,
          repo,
          pullNumber,
          installationId,
        ),
      ]);

      if (job.data.reviewId) {
        await this.prisma.review.update({
          where: { id: reviewId },
          data: {
            prTitle: prDetails.title,
            prDescription: prDetails.description ?? '',
            commitId,
            status: 'running',
          },
        });
      } else {
        await this.prisma.review.create({
          data: {
            id: reviewId,
            owner,
            repo,
            pullNumber,
            prTitle: prDetails.title,
            prDescription: prDetails.description ?? '',
            commitId,
            status: 'running',
            repositoryId,
          },
        });
      }

      const diff = files
        .filter(
          (f): f is { filename: string; patch: string } =>
            typeof f.patch === 'string' && f.patch.length > 0,
        )
        .map((f) => `--- ${f.filename} ---\n${f.patch}`)
        .join('\n\n');

      if (!diff.trim()) {
        this.logger.warn(
          `PR ${owner}/${repo}#${pullNumber} has no diff, skipping`,
        );
        await this.prisma.review.update({
          where: { id: reviewId },
          data: {
            status: 'completed',
            durationMs: Date.now() - reviewStart,
            completedAt: new Date(),
          },
        });
        return;
      }

      const fileNames = files
        .map((f) =>
          typeof (f as { filename?: unknown })?.filename === 'string'
            ? (f as { filename: string }).filename
            : undefined,
        )
        .filter((n): n is string => typeof n === 'string');
      this.logger.log(`Fetched ${files.length} changed files`);

      const docs = await this.retrieval.retrieve(diff.slice(0, 2000));
      this.appLogger.ragRetrievalComplete(docs.length);

      const context: ReviewContext = {
        title: prDetails.title,
        description: prDetails.description,
        files: fileNames,
        diff,
        docs,
      };

      repository = await this.prisma.repository.findUnique({
        where: { id: repositoryId },
        select: { userId: true },
      });

      if (repository) {
        this.realtime.emitToUser(repository.userId, 'review:started', {
          reviewId,
          owner,
          repo,
          pullNumber,
        });
      }

      const [apiKeys, user, agentPromptRows] = repository
        ? await Promise.all([
            this.apiKeysService.getDecrypted(repository.userId),
            this.prisma.user.findUnique({
              where: { id: repository.userId },
              select: {
                preferredProvider: true,
                preferredModel: true,
                ollamaBaseUrl: true,
              },
            }),
            this.prisma.userAgentPrompt.findMany({
              where: { userId: repository.userId },
            }),
          ])
        : [{}, null, []];

      const customPrompts = Object.fromEntries(
        (agentPromptRows ?? []).map((r) => [r.agent, r.prompt]),
      );

      const result = await this.orchestrator.execute(
        context,
        enabledAgents,
        apiKeys,
        user?.preferredProvider,
        user?.preferredModel,
        user?.ollamaBaseUrl,
        customPrompts,
      );

      // Apply severity threshold: filter findings before posting to GitHub and saving.
      const filtered = {
        ...result,
        bug: {
          ...result.bug,
          findings: result.bug.findings.filter((f) =>
            meetsThreshold(f.severity, severityThreshold),
          ),
        },
        security: {
          ...result.security,
          findings: result.security.findings.filter((f) =>
            meetsThreshold(f.severity, severityThreshold),
          ),
        },
        performance: {
          ...result.performance,
          findings: result.performance.findings.filter((f) =>
            meetsThreshold(f.severity, severityThreshold),
          ),
        },
        style: {
          ...result.style,
          findings: result.style.findings.filter((f) =>
            meetsThreshold(f.severity, severityThreshold),
          ),
        },
      };

      this.appLogger.postingComments(owner, repo, pullNumber);
      await this.commentsService.postOrchestratorResults(
        owner,
        repo,
        pullNumber,
        commitId,
        filtered,
        installationId,
        startCommentId,
      );

      const duration = Date.now() - reviewStart;

      const VALID_SEVERITIES = new Set<string>(['low', 'medium', 'high']);
      await this.prisma.finding.createMany({
        data: AGENT_TYPES.flatMap((agent) =>
          filtered[agent].findings
            .filter(
              (f) =>
                typeof f.line === 'number' &&
                Number.isFinite(f.line) &&
                VALID_SEVERITIES.has(f.severity) &&
                f.issue &&
                f.suggestion,
            )
            .map((f) => ({
              id: randomUUID(),
              agent,
              file: f.file,
              line: f.line,
              severity: f.severity,
              issue: f.issue,
              suggestion: f.suggestion,
              reviewId,
            })),
        ),
      });

      await this.prisma.reviewSummary.create({
        data: {
          id: randomUUID(),
          bugSummary: result.bug.summary,
          securitySummary: result.security.summary,
          performanceSummary: result.performance.summary,
          styleSummary: result.style.summary,
          overallSummary: result.overallSummary,
          reviewId,
        },
      });

      await this.prisma.review.update({
        where: { id: reviewId },
        data: {
          status: 'completed',
          durationMs: duration,
          completedAt: new Date(),
        },
      });

      this.appLogger.reviewComplete(owner, repo, pullNumber, duration);
      this.metrics.recordReviewDuration(duration);

      if (repository) {
        const findingsCount = AGENT_TYPES.reduce(
          (n, a) => n + filtered[a].findings.length,
          0,
        );
        this.realtime.emitToUser(repository.userId, 'review:completed', {
          reviewId,
          findingsCount,
          durationMs: duration,
        });
      }

      for (const agent of AGENT_TYPES) {
        for (const finding of result[agent].findings) {
          this.metrics.recordFindings(agent, finding.severity, 1);
        }
      }
    } catch (err) {
      this.appLogger.error(
        `ReviewProcessor(${owner}/${repo}#${pullNumber})`,
        err,
      );

      await this.commentsService.editToErrorComment(
        owner,
        repo,
        startCommentId,
        installationId,
        err,
      );

      const errMsg = err instanceof Error ? err.message : String(err);
      await this.prisma.review
        .update({
          where: { id: reviewId },
          data: {
            status: 'failed',
            errorReason: errMsg,
            durationMs: Date.now() - reviewStart,
          },
        })
        .catch(() => {});

      if (repository) {
        this.realtime.emitToUser(repository.userId, 'review:failed', {
          reviewId,
          reason: errMsg,
        });
      }

      throw err;
    } finally {
      span.end();
    }
  }
}
