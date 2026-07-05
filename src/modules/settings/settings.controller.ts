import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProvider } from '@/generated/prisma/enums';
import { AuthGuard } from '@/common/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AgentName } from '@/pipeline/agents/types';
import { ApiKeysService } from './api-keys.service';
import {
  REVIEW_PROVIDERS,
  ReviewProvider,
  SettingsService,
} from './settings.service';

const VALID_AGENTS: AgentName[] = ['bug', 'security', 'performance', 'style', 'summary'];

@ApiTags('Settings')
@ApiCookieAuth()
@Controller('settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  @Get('usage')
  @ApiOperation({
    summary: 'Current-month review usage and per-provider API cost breakdown',
  })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        thisMonthReviews: { type: 'number' },
        monthlyLimit: { type: 'number', example: 50 },
        apiUsage: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              provider: {
                type: 'string',
                enum: ['anthropic', 'google', 'openai', 'voyage'],
              },
              calls: { type: 'number' },
              inputTokens: { type: 'number' },
              outputTokens: { type: 'number' },
              costCents: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  getUsage(@CurrentUser() user: { id: string }) {
    return this.settingsService.getUsage(user.id);
  }

  @Get('api-keys')
  @ApiOperation({
    summary: 'List providers for which the user has a saved API key',
  })
  @ApiResponse({
    status: 200,
    schema: { type: 'array', items: { type: 'string' } },
  })
  listApiKeys(@CurrentUser() user: { id: string }) {
    return this.apiKeysService.listProviders(user.id);
  }

  @Put('api-keys/:provider')
  @HttpCode(204)
  @ApiOperation({ summary: 'Save or replace the API key for a provider' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  saveApiKey(
    @CurrentUser() user: { id: string },
    @Param('provider') provider: ApiProvider,
    @Body() body: { key: string },
  ) {
    return this.apiKeysService.upsert(user.id, provider, body.key);
  }

  @Delete('api-keys/:provider')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the saved API key for a provider' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  deleteApiKey(
    @CurrentUser() user: { id: string },
    @Param('provider') provider: ApiProvider,
  ) {
    return this.apiKeysService.remove(user.id, provider);
  }

  @Get('preferred-provider')
  @ApiOperation({ summary: "Get user's preferred review AI provider" })
  @ApiResponse({
    status: 200,
    schema: { properties: { provider: { type: 'string', nullable: true } } },
  })
  getPreferredProvider(@CurrentUser() user: { id: string }) {
    return this.settingsService
      .getPreferredProvider(user.id)
      .then((provider) => ({ provider }));
  }

  @Put('preferred-provider')
  @HttpCode(204)
  @ApiOperation({ summary: "Set user's preferred review AI provider" })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 400, description: 'Invalid provider' })
  setPreferredProvider(
    @CurrentUser() user: { id: string },
    @Body() body: { provider: ReviewProvider | null },
  ) {
    const valid =
      body.provider === null ||
      (REVIEW_PROVIDERS as readonly string[]).includes(body.provider);
    if (!valid) throw new Error(`Invalid provider: ${String(body.provider)}`);
    return this.settingsService.setPreferredProvider(user.id, body.provider);
  }

  @Get('models')
  @ApiOperation({ summary: 'List all available AI models' })
  @ApiResponse({ status: 200, schema: { type: 'array' } })
  getModels() {
    return this.settingsService.getModels();
  }

  @Get('preferred-model')
  @ApiOperation({ summary: "Get user's preferred AI model and provider" })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        model: { type: 'string', nullable: true },
        provider: { type: 'string', nullable: true },
      },
    },
  })
  getPreferredModel(@CurrentUser() user: { id: string }) {
    return this.settingsService.getPreferredModel(user.id);
  }

  @Put('preferred-model')
  @HttpCode(204)
  @ApiOperation({ summary: "Set user's preferred AI model" })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 400, description: 'Unknown model ID' })
  setPreferredModel(
    @CurrentUser() user: { id: string },
    @Body() body: { model: string | null; provider?: ApiProvider | null },
  ) {
    return this.settingsService.setPreferredModel(
      user.id,
      body.model,
      body.provider,
    );
  }

  @Get('ollama-url')
  @ApiOperation({ summary: "Get user's configured Ollama server URL" })
  @ApiResponse({
    status: 200,
    schema: { properties: { url: { type: 'string', nullable: true } } },
  })
  getOllamaUrl(@CurrentUser() user: { id: string }) {
    return this.settingsService.getOllamaUrl(user.id).then((url) => ({ url }));
  }

  @Put('ollama-url')
  @HttpCode(204)
  @ApiOperation({ summary: "Set user's Ollama server URL" })
  @ApiResponse({ status: 204 })
  setOllamaUrl(
    @CurrentUser() user: { id: string },
    @Body() body: { url: string | null },
  ) {
    return this.settingsService.setOllamaUrl(user.id, body.url);
  }

  @Get('agent-prompts')
  @ApiOperation({ summary: 'Get all agent instruction prompts for the current user' })
  @ApiResponse({ status: 200 })
  getAgentPrompts(@CurrentUser() user: { id: string }) {
    return this.settingsService.getAgentPrompts(user.id);
  }

  @Put('agent-prompts/:agent')
  @HttpCode(204)
  @ApiOperation({ summary: 'Update the instruction prompt for a specific agent' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 400, description: 'Invalid agent name or empty prompt' })
  async setAgentPrompt(
    @CurrentUser() user: { id: string },
    @Param('agent') agent: string,
    @Body() body: { prompt: string },
  ) {
    if (!(VALID_AGENTS as string[]).includes(agent)) {
      throw new BadRequestException(`Invalid agent: ${agent}`);
    }
    if (!body.prompt?.trim()) {
      throw new BadRequestException('Prompt cannot be empty');
    }
    return this.settingsService.setAgentPrompt(user.id, agent as AgentName, body.prompt.trim());
  }

  @Get('ollama-models')
  @ApiOperation({
    summary: 'List models available on the configured Ollama server',
  })
  @ApiResponse({ status: 200 })
  getOllamaModels(
    @CurrentUser() user: { id: string },
    @Query('url') url?: string,
  ) {
    return this.settingsService.getOllamaModels(user.id, url);
  }

}
