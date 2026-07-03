import { Injectable, Logger } from '@nestjs/common';
import { verifySignature } from '@/integrations/github/verify-signature';
import { PrismaService } from '@/core/prisma/prisma.service';
import { RealtimeService } from '@/core/realtime/realtime.service';
import {
  GithubInstallationPayload,
  GithubInstallationRepositoriesPayload,
} from '../webhooks.types';

type RepoEntry = { name: string; full_name: string };

@Injectable()
export class InstallationHandler {
  private readonly logger = new Logger(InstallationHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  handle(
    event: string,
    payload: GithubInstallationPayload,
    signature: string,
    rawBody: string,
  ) {
    if (!verifySignature(rawBody, signature)) {
      this.logger.warn('Webhook signature verification failed');
      return { invalidSignature: true };
    }

    switch (payload.action) {
      case 'created':
        return this.handleCreated(payload);

      case 'deleted':
        return this.handleDeleted(payload);

      case 'suspend':
      case 'unsuspend':
      case 'new_permissions_accepted':
        this.logger.log(`Unhandled action: ${event}.${payload.action}`);
        return { received: true, event, action: payload.action };

      default:
        this.logger.warn(`Unknown action: ${event}.${payload.action}`);
        return { received: true, event, action: payload.action };
    }
  }

  handleRepositories(
    event: string,
    payload: GithubInstallationRepositoriesPayload,
    signature: string,
    rawBody: string,
  ) {
    if (!verifySignature(rawBody, signature)) {
      this.logger.warn('Webhook signature verification failed');
      return { invalidSignature: true };
    }

    switch (payload.action) {
      case 'added':
        return this.handleRepositoriesAdded(payload);

      case 'removed':
        return this.handleRepositoriesRemoved(payload);

      default:
        this.logger.warn(`Unknown action: ${event}.${payload.action}`);
        return { received: true, event, action: payload.action };
    }
  }

  private async handleCreated(payload: GithubInstallationPayload) {
    const githubAccountId = payload.sender.id.toString();
    const repos = payload.repositories ?? [];
    const isOrgInstall = payload.installation.account.type === 'Organization';
    const orgLogin = payload.installation.account.login;

    const account = await this.prisma.account.findFirst({
      where: { providerId: 'github', accountId: githubAccountId },
    });

    if (isOrgInstall) {
      if (account) {
        const org = await this.prisma.organization.upsert({
          where: { slug: orgLogin },
          create: { name: orgLogin, slug: orgLogin },
          update: {},
        });
        await this.prisma.member.upsert({
          where: { organizationId_userId: { organizationId: org.id, userId: account.userId } },
          create: { organizationId: org.id, userId: account.userId, role: 'owner' },
          update: {},
        });
        await this.syncRepositoriesForOrg(account.userId, org.id, payload.installation.id, repos);
        this.realtime.emitToUser(account.userId, 'github-app:installed', {});
        this.logger.log(`GitHub App installed for org ${orgLogin} by user ${account.userId}`);
        return { updated: true, org: orgLogin };
      }

      await this.prisma.pendingInstallation.upsert({
        where: { githubAccountId },
        create: {
          githubAccountId,
          githubLogin: payload.sender.login,
          installationId: payload.installation.id,
          repositories: repos,
          isOrgInstall: true,
          orgLogin,
        },
        update: {
          githubLogin: payload.sender.login,
          installationId: payload.installation.id,
          repositories: repos,
          isOrgInstall: true,
          orgLogin,
        },
      });

      this.logger.warn(
        `No account found for GitHub user ${payload.sender.login}, stored as pending org installation for ${orgLogin}`,
      );
      return { pending: true, org: orgLogin };
    }

    // Personal install
    if (account) {
      await this.prisma.user.update({
        where: { id: account.userId },
        data: { hasGithubApp: true },
      });
      await this.syncRepositories(account.userId, payload.installation.id, repos);
      this.realtime.emitToUser(account.userId, 'github-app:installed', {});
      this.logger.log(
        `GitHub App installed for user ${account.userId}, synced ${repos.length} repos`,
      );
      return { updated: true };
    }

    await this.prisma.pendingInstallation.upsert({
      where: { githubAccountId },
      create: {
        githubAccountId,
        githubLogin: payload.sender.login,
        installationId: payload.installation.id,
        repositories: repos,
      },
      update: {
        githubLogin: payload.sender.login,
        installationId: payload.installation.id,
        repositories: repos,
      },
    });

    this.logger.warn(
      `No account found for GitHub user ${payload.sender.login}, stored as pending installation`,
    );
    return { pending: true };
  }

  private async handleDeleted(payload: GithubInstallationPayload) {
    const githubAccountId = payload.sender.id.toString();
    const isOrgInstall = payload.installation.account.type === 'Organization';
    const orgLogin = payload.installation.account.login;

    if (isOrgInstall) {
      const org = await this.prisma.organization.findUnique({ where: { slug: orgLogin } });
      if (org) {
        await this.prisma.repository.deleteMany({ where: { organizationId: org.id } });
        this.logger.log(`GitHub App uninstalled for org ${orgLogin}`);
      }
      return { deleted: true };
    }

    const account = await this.prisma.account.findFirst({
      where: { providerId: 'github', accountId: githubAccountId },
    });

    if (account) {
      await this.prisma.user.update({
        where: { id: account.userId },
        data: { hasGithubApp: false },
      });
      await this.prisma.repository.deleteMany({
        where: {
          userId: account.userId,
          installationId: payload.installation.id,
          organizationId: null,
        },
      });
      this.logger.log(`GitHub App uninstalled for user ${account.userId}`);
      return { deleted: true };
    }

    await this.prisma.pendingInstallation.deleteMany({ where: { githubAccountId } });
    return { deleted: true };
  }

  private async handleRepositoriesAdded(
    payload: GithubInstallationRepositoriesPayload,
  ) {
    const githubAccountId = payload.sender.id.toString();
    const repos = payload.repositories_added;
    const isOrgInstall = payload.installation.account.type === 'Organization';
    const orgLogin = payload.installation.account.login;

    if (isOrgInstall) {
      const org = await this.prisma.organization.findUnique({ where: { slug: orgLogin } });
      if (!org) return { skipped: true };
      const account = await this.prisma.account.findFirst({
        where: { providerId: 'github', accountId: githubAccountId },
      });
      if (!account) return { skipped: true };
      await this.syncRepositoriesForOrg(account.userId, org.id, payload.installation.id, repos);
      this.logger.log(`Added ${repos.length} repos for org ${orgLogin}`);
      return { added: repos.length };
    }

    const account = await this.prisma.account.findFirst({
      where: { providerId: 'github', accountId: githubAccountId },
    });

    if (!account) {
      this.logger.warn(
        `No account found for GitHub user ${payload.sender.login} on repositories.added`,
      );
      return { skipped: true };
    }

    await this.syncRepositories(account.userId, payload.installation.id, repos);
    this.logger.log(`Added ${repos.length} repos for user ${account.userId}`);
    return { added: repos.length };
  }

  private async handleRepositoriesRemoved(
    payload: GithubInstallationRepositoriesPayload,
  ) {
    const githubAccountId = payload.sender.id.toString();
    const repos = payload.repositories_removed;
    const isOrgInstall = payload.installation.account.type === 'Organization';
    const orgLogin = payload.installation.account.login;

    const repoConditions = repos.map((r) => {
      const [owner, repo] = r.full_name.split('/');
      return { owner, repo };
    });

    if (isOrgInstall) {
      const org = await this.prisma.organization.findUnique({ where: { slug: orgLogin } });
      if (!org) return { skipped: true };
      await this.prisma.repository.deleteMany({
        where: { organizationId: org.id, OR: repoConditions },
      });
      this.logger.log(`Removed ${repos.length} repos for org ${orgLogin}`);
      return { removed: repos.length };
    }

    const account = await this.prisma.account.findFirst({
      where: { providerId: 'github', accountId: githubAccountId },
    });

    if (!account) {
      this.logger.warn(
        `No account found for GitHub user ${payload.sender.login} on repositories.removed`,
      );
      return { skipped: true };
    }

    await this.prisma.repository.deleteMany({
      where: {
        userId: account.userId,
        installationId: payload.installation.id,
        OR: repoConditions,
      },
    });

    this.logger.log(`Removed ${repos.length} repos for user ${account.userId}`);
    return { removed: repos.length };
  }

  private async syncRepositories(
    userId: string,
    installationId: number,
    repos: RepoEntry[],
  ) {
    for (const entry of repos) {
      const [owner, repo] = entry.full_name.split('/');
      await this.prisma.repository.upsert({
        where: { owner_repo_userId: { owner, repo, userId } },
        create: { owner, repo, installationId, userId, enabledAgents: [] },
        update: { installationId },
      });
    }
  }

  private async syncRepositoriesForOrg(
    userId: string,
    organizationId: string,
    installationId: number,
    repos: RepoEntry[],
  ) {
    for (const entry of repos) {
      const [owner, repo] = entry.full_name.split('/');
      await this.prisma.repository.upsert({
        where: { owner_repo_organizationId: { owner, repo, organizationId } },
        create: { owner, repo, installationId, userId, organizationId, enabledAgents: [] },
        update: { installationId },
      });
    }
  }
}
