import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { TenantRequest } from '@/common/middleware/tenant.middleware';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@UseGuards(AuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('current')
  getCurrentOrg(@Req() req: TenantRequest) {
    if (!req.tenantOrgId) throw new NotFoundException('Not on an org subdomain');
    return this.orgs.getCurrentOrg(req.tenantOrgId);
  }

  @Get('members')
  getMembers(@Req() req: TenantRequest) {
    if (!req.tenantOrgId) throw new NotFoundException('Not on an org subdomain');
    return this.orgs.getMembers(req.tenantOrgId);
  }

  @Post('invite')
  createInvitation(
    @Req() req: TenantRequest,
    @CurrentUser() user: { id: string },
    @Body() body: { email: string; role?: string },
  ) {
    if (!req.tenantOrgId) throw new NotFoundException('Not on an org subdomain');
    return this.orgs.createInvitation(req.tenantOrgId, user.id, body.email, body.role);
  }

  @Delete('members/:memberId')
  removeMember(
    @Req() req: TenantRequest,
    @CurrentUser() user: { id: string },
    @Param('memberId') memberId: string,
  ) {
    if (!req.tenantOrgId) throw new NotFoundException('Not on an org subdomain');
    return this.orgs.removeMember(req.tenantOrgId, memberId, user.id);
  }
}
