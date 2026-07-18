import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@/generated/prisma/enums';
import { PrismaService } from '@/core/prisma/prisma.service';
import { decrypt, encrypt } from '@/common/utils/crypto';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.getOrThrow<string>('BETTER_AUTH_SECRET');
  }

  async upsert(
    userId: string,
    provider: ApiProvider,
    rawKey: string,
  ): Promise<void> {
    const encrypted = encrypt(rawKey, this.secret);
    await this.prisma.userApiKey.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, encrypted },
      update: { encrypted },
    });
  }

  async remove(userId: string, provider: ApiProvider): Promise<void> {
    await this.prisma.userApiKey.deleteMany({ where: { userId, provider } });
  }

  async listProviders(userId: string): Promise<ApiProvider[]> {
    const keys = await this.prisma.userApiKey.findMany({
      where: { userId },
      select: { provider: true },
    });
    return keys.map((k) => k.provider);
  }

  async getDecrypted(
    userId: string,
  ): Promise<Partial<Record<ApiProvider, string>>> {
    const keys = await this.prisma.userApiKey.findMany({ where: { userId } });
    return Object.fromEntries(
      keys.map((k) => [k.provider, decrypt(k.encrypted, this.secret)]),
    );
  }
}
