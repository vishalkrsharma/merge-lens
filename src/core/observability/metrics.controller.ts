import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';
import { MetricsService } from './metrics.service';

@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
