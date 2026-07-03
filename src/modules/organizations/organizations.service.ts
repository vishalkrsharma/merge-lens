import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/core/prisma/prisma.service';
import { auth } from '@/core/auth/auth';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentOrg(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async getMembers(orgId: string) {
    return this.prisma.member.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createInvitation(orgId: string, inviterId: string, email: string, role: string = 'member') {
    await this.assertMember(orgId, inviterId);
    return auth.api.createInvitation({
      body: { email, role, organizationId: orgId },
      headers: new Headers(),
    });
  }

  async removeMember(orgId: string, memberId: string, requesterId: string) {
    await this.assertOwner(orgId, requesterId);
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
    });
    if (!member) throw new NotFoundException('Member not found');
    await this.prisma.member.delete({ where: { id: memberId } });
  }

  private async assertMember(orgId: string, userId: string) {
    const m = await this.prisma.member.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!m) throw new ForbiddenException('Not a member of this organization');
  }

  private async assertOwner(orgId: string, userId: string) {
    const m = await this.prisma.member.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!m || m.role !== 'owner') throw new ForbiddenException('Only the org owner can do this');
  }
}
