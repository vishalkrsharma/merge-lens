import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentFinding, OrchestratorResult } from '@/pipeline/agents/types';
import { GithubService } from '@/integrations/github/github.service';

const WATERMARK = '<!-- mergelens-review -->';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly config: ConfigService,
  ) {}

  async postStartComment(
    owner: string,
    repo: string,
    pullNumber: number,
    installationId: number,
  ): Promise<number | null> {
    try {
      const body = this.buildStartComment();
      const commentId = await this.githubService.postIssueComment(
        owner,
        repo,
        pullNumber,
        body,
        installationId,
      );
      this.logger.log('Posted review-started comment');
      return commentId;
    } catch (err) {
      this.logger.warn(`Failed to post start comment: ${String(err)}`);
      return null;
    }
  }

  async editToErrorComment(
    owner: string,
    repo: string,
    commentId: number | null,
    installationId: number,
    cause?: unknown,
  ): Promise<void> {
    if (commentId === null) return;
    try {
      await this.githubService.updateIssueComment(
        owner,
        repo,
        commentId,
        this.buildErrorComment(cause),
        installationId,
      );
      this.logger.log('Updated comment to error state');
    } catch (err) {
      this.logger.warn(
        `Failed to update comment to error state: ${String(err)}`,
      );
    }
  }

  async postOrchestratorResults(
    owner: string,
    repo: string,
    pullNumber: number,
    commitId: string,
    result: OrchestratorResult,
    installationId: number,
    startCommentId: number | null,
  ): Promise<void> {
    const summaryBody = this.buildReviewComment(result);

    if (startCommentId !== null) {
      try {
        await this.githubService.updateIssueComment(
          owner,
          repo,
          startCommentId,
          summaryBody,
          installationId,
        );
        this.logger.log('Updated start comment with review results');
      } catch (err) {
        this.logger.warn(
          `Failed to edit start comment, posting new one: ${String(err)}`,
        );
        await this.githubService.postIssueComment(
          owner,
          repo,
          pullNumber,
          summaryBody,
          installationId,
        );
      }
    } else {
      await this.githubService.postIssueComment(
        owner,
        repo,
        pullNumber,
        summaryBody,
        installationId,
      );
    }

    this.logger.log('Posted PR summary comment');

    const allFindings: Array<{ agent: string; finding: AgentFinding }> = [
      ...result.bug.findings.map((f) => ({ agent: 'bug', finding: f })),
      ...result.security.findings.map((f) => ({
        agent: 'security',
        finding: f,
      })),
      ...result.performance.findings.map((f) => ({
        agent: 'performance',
        finding: f,
      })),
      ...result.style.findings.map((f) => ({ agent: 'style', finding: f })),
    ];

    for (const { agent, finding } of allFindings) {
      try {
        await this.githubService.postReviewComment(
          owner,
          repo,
          pullNumber,
          commitId,
          finding.file,
          finding.line,
          this.formatFinding(agent, finding),
          installationId,
        );
      } catch {
        this.logger.warn(
          `Skipped inline comment on ${finding.file}:${finding.line}`,
        );
      }
    }
  }

  private frontendUrl(): string {
    const urls = this.config.get<string>('FRONTEND_URLS') ?? '';
    return urls.split(',')[0]?.trim() || 'https://merge-lens.vercel.app';
  }

  private buildStartComment(): string {
    return [
      WATERMARK,
      '## 🔍 MergeLens is reviewing this PR',
      '',
      'Four specialized AI agents are analyzing your changes for bugs, security vulnerabilities, performance issues, and style concerns.',
      'This comment will be updated with the full report once the review completes.',
      '',
      '| Agent                 | Status         |',
      '|-----------------------|----------------|',
      '| 🐛 Bug detection      | `analyzing…`   |',
      '| 🔒 Security analysis  | `analyzing…`   |',
      '| ⚡ Performance review | `analyzing…`   |',
      '| ✨ Style & quality    | `analyzing…`   |',
      '',
      '---',
      '_Powered by [MergeLens](https://merge-lens.vercel.app) · multi-agent AI review_',
    ].join('\n');
  }

  private classifyError(err: unknown): {
    headline: string;
    detail: string;
    hint: string | null;
  } {
    const msg = err instanceof Error ? err.message : String(err);
    const msgLower = msg.toLowerCase();
    const settingsUrl = `${this.frontendUrl()}/settings/models`;

    if (
      msgLower.includes('timed out') ||
      msgLower.includes('timeout') ||
      msgLower.includes('etimedout') ||
      msgLower.includes('deadline')
    ) {
      return {
        headline: 'Review timed out',
        detail:
          'The AI provider took too long to respond. This can happen with large diffs or when the provider is under load.',
        hint: 'Push a new commit or close and reopen this PR to retry. If the issue persists, try reducing the diff size.',
      };
    }

    if (
      msgLower.includes('rate limit') ||
      msgLower.includes('ratelimit') ||
      msgLower.includes('429') ||
      msgLower.includes('too many requests') ||
      msgLower.includes('quota')
    ) {
      return {
        headline: 'AI provider rate limit reached',
        detail:
          'Your API key has hit its rate limit or quota with the AI provider.',
        hint: 'Wait a few minutes, then push a new commit or reopen this PR to retry.',
      };
    }

    if (
      msgLower.includes('401') ||
      msgLower.includes('403') ||
      msgLower.includes('unauthorized') ||
      msgLower.includes('forbidden') ||
      msgLower.includes('invalid api key') ||
      msgLower.includes('invalid_api_key') ||
      msgLower.includes('authentication')
    ) {
      return {
        headline: 'AI provider authentication failed',
        detail: 'The API key is missing, invalid, or has been revoked.',
        hint: `Visit [MergeLens → Settings → AI Models](${settingsUrl}) to update your API key, then push a new commit to retry.`,
      };
    }

    if (
      msgLower.includes('no provider') ||
      msgLower.includes('unsupported provider') ||
      msgLower.includes('no api key') ||
      msgLower.includes('api key not') ||
      msgLower.includes('missing key')
    ) {
      return {
        headline: 'No AI provider configured',
        detail: 'No API key has been set for any AI provider.',
        hint: `Visit [MergeLens → Settings → AI Models](${settingsUrl}) to add your API key, then push a new commit to trigger a review.`,
      };
    }

    if (
      msgLower.includes('network') ||
      msgLower.includes('econnrefused') ||
      msgLower.includes('econnreset') ||
      msgLower.includes('enotfound') ||
      msgLower.includes('socket hang up') ||
      msgLower.includes('fetch failed')
    ) {
      return {
        headline: 'Network error reaching AI provider',
        detail: 'A network error occurred while communicating with the AI provider.',
        hint: 'This is usually transient. Push a new commit or close and reopen this PR to retry.',
      };
    }

    return {
      headline: 'Review failed',
      detail: 'An unexpected error occurred during the AI review.',
      hint: `If this keeps happening, check [MergeLens → Settings → AI Models](${settingsUrl}) to ensure your API key is valid.`,
    };
  }

  private buildErrorComment(cause?: unknown): string {
    const { headline, detail, hint } = this.classifyError(cause);
    const lines = [
      WATERMARK,
      `## ⚠️ MergeLens — ${headline}`,
      '',
      detail,
    ];

    if (hint) {
      lines.push('', `**What to do:** ${hint}`);
    }

    lines.push('', '---', '_Powered by [MergeLens](https://merge-lens.vercel.app) · multi-agent AI review_');
    return lines.join('\n');
  }

  private buildReviewComment(result: OrchestratorResult): string {
    const totalFindings =
      result.bug.findings.length +
      result.security.findings.length +
      result.performance.findings.length +
      result.style.findings.length;

    const sections: string[] = [
      WATERMARK,
      `## ✅ MergeLens Review Complete — ${totalFindings} finding${totalFindings !== 1 ? 's' : ''}`,
      '',
      `### Summary\n${result.overallSummary}`,
      '',
    ];

    const agentSections: Array<{
      label: string;
      icon: string;
      response: typeof result.bug;
    }> = [
      { label: 'Bug Analysis', icon: '🐛', response: result.bug },
      { label: 'Security Analysis', icon: '🔒', response: result.security },
      {
        label: 'Performance Analysis',
        icon: '⚡',
        response: result.performance,
      },
      { label: 'Style Analysis', icon: '✨', response: result.style },
    ];

    for (const { label, icon, response } of agentSections) {
      sections.push(`### ${icon} ${label}`);
      sections.push(response.summary);
      if (response.findings.length > 0) {
        const high = response.findings.filter(
          (f) => f.severity === 'high',
        ).length;
        const med = response.findings.filter(
          (f) => f.severity === 'medium',
        ).length;
        const low = response.findings.filter(
          (f) => f.severity === 'low',
        ).length;
        sections.push(
          `\n_Findings: ${high} high · ${med} medium · ${low} low — see inline comments for details_`,
        );
      }
      sections.push('');
    }

    sections.push('---');
    sections.push(
      '_Powered by [MergeLens](https://merge-lens.vercel.app) · multi-agent AI review_',
    );
    return sections.join('\n');
  }

  private formatFinding(agent: string, finding: AgentFinding): string {
    const icons: Record<string, string> = {
      bug: '🐛',
      security: '🔒',
      performance: '⚡',
      style: '✨',
    };
    const severityBadge =
      { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' }[
        finding.severity
      ] ?? finding.severity;
    return `${icons[agent] ?? '📌'} **${severityBadge}** (${agent})\n\n${finding.issue}\n\n**Suggestion:** ${finding.suggestion}`;
  }
}
