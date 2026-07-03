import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaService } from '@/core/prisma/prisma.service';
import { openAPI, organization } from 'better-auth/plugins';

export const prisma = new PrismaService();

const frontendUrls = process.env.FRONTEND_URLS?.split(',').map((o) =>
  o.trim(),
) ?? ['http://localhost:3000'];

async function syncOrgRepos(
  userId: string,
  organizationId: string,
  installationId: number,
  repositories: unknown,
) {
  if (!Array.isArray(repositories)) return;
  const repos = repositories as { name: string; full_name: string }[];
  for (const entry of repos) {
    const [owner, repo] = entry.full_name.split('/');
    await prisma.repository.upsert({
      where: { owner_repo_organizationId: { owner, repo, organizationId } },
      create: { owner, repo, installationId, userId, organizationId, enabledAgents: [] },
      update: { installationId },
    });
  }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  user: {
    additionalFields: {
      hasGithubApp: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      scope: ['user', 'user:email', 'repo', 'write:org'],
    },
  },
  trustedOrigins: [
    ...frontendUrls,
    ...(process.env.NODE_ENV !== 'production' ? ['http://*.localhost:3000'] : []),
  ],
  account: {
    // Skips the redundant signed-cookie check in the DB state strategy.
    // That cookie has a 5-min TTL while the DB state has a 10-min TTL, so
    // any GitHub auth flow that takes >5 min raises a false state_mismatch.
    skipStateCookieCheck: true,
  },
  onAPIError: {
    // Redirect auth errors to the frontend instead of the backend root.
    errorURL: frontendUrls[0],
  },
  advanced: {
    useSecureCookies: true,
    cookies: {
      session_token: {
        attributes: {
          sameSite: 'none',
          secure: true,
        },
      },
    },
  },
  experimental: { joins: true },
  plugins: [openAPI(), organization()],
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          if (account.providerId !== 'github') return;

          const pending = await prisma.pendingInstallation.findUnique({
            where: { githubAccountId: account.accountId },
          });

          if (!pending) return;

          if (pending.isOrgInstall && pending.orgLogin) {
            const org = await prisma.organization.upsert({
              where: { slug: pending.orgLogin },
              create: { name: pending.orgLogin, slug: pending.orgLogin },
              update: {},
            });
            await prisma.member.upsert({
              where: { organizationId_userId: { organizationId: org.id, userId: account.userId } },
              create: { organizationId: org.id, userId: account.userId, role: 'owner' },
              update: {},
            });
            await syncOrgRepos(account.userId, org.id, pending.installationId, pending.repositories);
          } else {
            await prisma.user.update({
              where: { id: account.userId },
              data: { hasGithubApp: true },
            });

            if (Array.isArray(pending.repositories)) {
              const repos = pending.repositories as { name: string; full_name: string }[];
              for (const entry of repos) {
                const [owner, repo] = entry.full_name.split('/');
                await prisma.repository.upsert({
                  where: { owner_repo_userId: { owner, repo, userId: account.userId } },
                  create: {
                    owner,
                    repo,
                    installationId: pending.installationId,
                    userId: account.userId,
                    enabledAgents: [],
                  },
                  update: { installationId: pending.installationId },
                });
              }
            }
          }

          await prisma.pendingInstallation.delete({ where: { id: pending.id } });
        },
      },
    },
  },
});
