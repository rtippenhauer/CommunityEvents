import {
  Controller, Get, Patch, Body, Query, Param, ParseIntPipe,
  UseGuards, Request, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { PointsService } from './points.service';
import { AchievementsService } from './achievements.service';
import { UserRole } from '../../database/entities/user.entity';

@Controller()
export class CommunityController {
  constructor(
    private readonly pointsService: PointsService,
    private readonly achievementsService: AchievementsService,
  ) {}

  // ── Leaderboard (public) ────────────────────────────────────────────────────

  @Get('leaderboard')
  @UseGuards(OptionalJwtAuthGuard)
  async getLeaderboard(@Query('cityId') cityId?: string) {
    const cid = cityId ? parseInt(cityId, 10) : undefined;
    return this.pointsService.getLeaderboard(cid);
  }

  // ── My points & achievements ─────────────────────────────────────────────────

  @Get('members/me/points')
  @UseGuards(JwtAuthGuard)
  async getMyPoints(@Request() req: any) {
    return this.pointsService.getSummary(req.user.id);
  }

  @Get('members/me/achievements')
  @UseGuards(JwtAuthGuard)
  async getMyAchievements(@Request() req: any) {
    const [earned, all] = await Promise.all([
      this.achievementsService.getMemberAchievements(req.user.id),
      this.achievementsService.getAllAchievements(),
    ]);
    const earnedIds = new Set(earned.map((ma) => ma.achievementId));
    return {
      earned: earned.map((ma) => ({ ...ma.achievement, earnedAt: ma.earnedAt })),
      locked: all.filter((a) => !earnedIds.has(a.id) && !a.isSecret),
    };
  }

  @Patch('members/me/title')
  @UseGuards(JwtAuthGuard)
  async selectTitle(@Request() req: any, @Body() body: { title: string | null }) {
    try {
      await this.achievementsService.selectTitle(req.user.id, body.title ?? null);
    } catch {
      throw new BadRequestException('You have not earned that title');
    }
    return { ok: true };
  }

  // ── Member points by id (for public profile) ────────────────────────────────

  @Get('members/:id/points')
  @UseGuards(OptionalJwtAuthGuard)
  async getMemberPoints(@Param('id', ParseIntPipe) id: number) {
    return this.pointsService.getSummary(id);
  }

  @Get('members/:id/achievements')
  @UseGuards(OptionalJwtAuthGuard)
  async getMemberAchievements(@Param('id', ParseIntPipe) id: number) {
    const [earned, all] = await Promise.all([
      this.achievementsService.getMemberAchievements(id),
      this.achievementsService.getAllAchievements(),
    ]);
    const earnedIds = new Set(earned.map((ma) => ma.achievementId));
    return {
      earned: earned.map((ma) => ({ ...ma.achievement, earnedAt: ma.earnedAt })),
      locked: all.filter((a) => !earnedIds.has(a.id) && !a.isSecret),
    };
  }

  // ── Admin ────────────────────────────────────────────────────────────────────

  @Get('admin/members/:id/points/ledger')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async getLedger(@Param('id', ParseIntPipe) id: number) {
    return this.pointsService.getLedger(id);
  }

  @Get('admin/members/:id/achievements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async adminGetAchievements(@Param('id', ParseIntPipe) id: number) {
    return this.achievementsService.getMemberAchievements(id);
  }

  @Patch('admin/members/:id/achievements/grant')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminGrant(@Param('id', ParseIntPipe) id: number, @Body() body: { key: string }) {
    await this.achievementsService.adminGrantAchievement(id, body.key);
    return { ok: true };
  }

  @Patch('admin/members/:id/achievements/:achievementId/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminRevoke(
    @Param('id', ParseIntPipe) id: number,
    @Param('achievementId', ParseIntPipe) achievementId: number,
  ) {
    await this.achievementsService.adminRevokeAchievement(id, achievementId);
    return { ok: true };
  }

  @Patch('admin/points/:pointId/remove')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminRemovePoint(@Param('pointId', ParseIntPipe) pointId: number) {
    await this.pointsService.adminRemovePoints(pointId);
    return { ok: true };
  }
}
