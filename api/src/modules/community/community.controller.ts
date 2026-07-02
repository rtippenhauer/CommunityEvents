import {
  Controller, Get, Post, Patch, Body, Query, Param, ParseIntPipe,
  UseGuards, UseInterceptors, UploadedFile, Request, ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import type { FileFilterCallback } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { PointsService } from './points.service';
import { AchievementsService } from './achievements.service';
import { UserRole } from '../../database/entities/user.entity';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const achievementImageStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dest = join(process.env.UPLOAD_PATH ?? '/app/uploads', 'achievements');
    mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

const imageFilter = (_req: any, file: Express.Multer.File, cb: FileFilterCallback): void => {
  const ext = extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
  }
};

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
    return this.achievementsService.getAchievementsWithProgress(req.user.id);
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
    return this.achievementsService.getAchievementsWithProgress(id);
  }

  // ── Event achievement (public read) ──────────────────────────────────────────

  @Get('events/:eventId/achievement')
  @UseGuards(OptionalJwtAuthGuard)
  async getEventAchievement(@Param('eventId', ParseIntPipe) eventId: number) {
    const ach = await this.achievementsService.getEventAchievement(eventId);
    return ach ?? null;
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
    return this.achievementsService.getAchievementsWithProgress(id);
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

  // ── Admin: event-specific one-time achievements ──────────────────────────────

  @Post('admin/events/:eventId/achievement')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createEventAchievement(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() body: { name: string; description: string; title?: string; points: number },
  ) {
    if (!body.name || !body.description) {
      throw new BadRequestException('name and description are required');
    }
    const ach = await this.achievementsService.createEventAchievement({
      eventId,
      name: body.name,
      description: body.description,
      title: body.title,
      points: body.points ?? 0,
    });
    return ach;
  }

  @Get('admin/achievements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  adminListAchievements() {
    return this.achievementsService.adminListAchievements();
  }

  @Post('admin/achievements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminCreateAchievement(
    @Body() body: {
      key: string; name: string; description: string; icon: string;
      progressType: string; progressTarget?: number | null;
      points: number; title?: string | null; isSecret?: boolean;
    },
  ) {
    if (!body.key || !body.name || !body.description || !body.progressType) {
      throw new BadRequestException('key, name, description, and progressType are required');
    }
    return this.achievementsService.adminCreateAchievement({
      ...body,
      progressType: body.progressType as any,
      progressTarget: body.progressTarget ?? null,
      isSecret: body.isSecret ?? false,
    });
  }

  @Patch('admin/achievements/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateAchievement(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      name: string; description: string; icon?: string;
      title?: string | null; points: number; isSecret: boolean;
      progressTarget?: number | null;
    },
  ) {
    if (!body.name || !body.description) throw new BadRequestException('name and description are required');
    await this.achievementsService.adminFullUpdate(id, {
      name: body.name,
      description: body.description,
      icon: body.icon ?? 'emoji_events',
      points: body.points,
      title: body.title,
      isSecret: body.isSecret,
      progressTarget: body.progressTarget,
    });
    return { ok: true };
  }

  @Post('admin/achievements/backfill-founders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async backfillFounders() {
    return this.achievementsService.adminBackfillFounders();
  }

  @Post('admin/achievements/:id/image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: achievementImageStorage,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadAchievementImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No image uploaded');
    const imagePath = `/api/uploads/achievements/${file.filename}`;
    await this.achievementsService.updateAchievementImage(id, imagePath);
    return { imagePath };
  }
}
