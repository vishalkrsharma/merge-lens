import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '@/core/prisma/prisma.service';

export interface TenantRequest extends Request {
  tenantOrgId?: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: TenantRequest, _res: Response, next: NextFunction) {
    const slug = req.headers['x-tenant-slug'] as string | undefined;
    if (slug) {
      const org = await this.prisma.organization.findUnique({ where: { slug } });
      if (org) req.tenantOrgId = org.id;
    }
    next();
  }
}
