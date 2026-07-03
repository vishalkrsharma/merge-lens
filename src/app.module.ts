import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './core/auth/auth';
import { PrismaModule } from './core/prisma/prisma.module';
import { QueueModule } from './core/queue/queue.module';
import { ObservabilityModule } from './core/observability/observability.module';
import { AgentsModule } from './pipeline/agents/agents.module';
import { AiReviewModule } from './pipeline/ai-review/ai-review.module';
import { OrchestratorModule } from './pipeline/orchestrator/orchestrator.module';
import { ReviewModule } from './pipeline/processor/review.module';
import { RagModule } from './pipeline/rag/rag.module';
import { CommentsModule } from './integrations/comments/comments.module';
import { GithubModule } from './integrations/github/github.module';
import { FindingsModule } from './modules/findings/findings.module';
import { HealthModule } from './modules/health/health.module';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StatsModule } from './modules/stats/stats.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { RealtimeModule } from './core/realtime/realtime.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: true },
        },
      },
    }),
    PrismaModule,
    AuthModule.forRoot({ auth }),
    RealtimeModule,
    ObservabilityModule,
    QueueModule,
    GithubModule,
    CommentsModule,
    AgentsModule,
    AiReviewModule,
    OrchestratorModule,
    RagModule,
    ReviewModule,
    HealthModule,
    WebhooksModule,
    FindingsModule,
    RepositoriesModule,
    ReviewsModule,
    SettingsModule,
    StatsModule,
    OrganizationsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
