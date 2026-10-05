import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { SystemReportsService } from './system-reports.service';
import { CreateSystemBugDto } from './dto/create-system-bug.dto';
import { UpdateSystemBugDto } from './dto/update-system-bug.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { NonDemoTenantGuard } from '../../common/guards/tenant-kind.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

/**
 * The shared defect board (v2-32).
 *
 * Filed by an admin of any **non-demo** community, read by the admins of every
 * other non-demo community, and triaged only by the system admin on the root
 * tenant. That read-everywhere/write-nowhere split is Rob's (2026-10-04) and is
 * what makes the board worth having: an admin can see a defect is already known
 * instead of filing it again, without being able to edit somebody else's report.
 *
 * ## Why `NonDemoTenantGuard` is on every route and not just the write
 *
 * `demo.service` makes every demo requester an admin, so without it "any tenant
 * admin may read the board" means "anybody who filled in the demo form may read
 * every defect report ever filed, including the free text inside it". Reading is
 * the half that matters here -- a stranger filing noise is a nuisance, a
 * stranger reading other communities' operational detail is the v2-14 failure
 * again.
 *
 * ## Why this is not `/admin/...`
 *
 * It acts on something deployment-wide rather than inside the caller's
 * community, which is the same reason tenant management lives under `system/`.
 */
@Controller('system/bugs')
@UseGuards(JwtAuthGuard, RolesGuard, NonDemoTenantGuard)
export class SystemBugsController {
  constructor(private readonly reports: SystemReportsService) {}

  /**
   * **Any member of a real community may file** (Rob, 2026-10-04).
   *
   * This was admins-only, on the argument that an admin can tell a platform
   * defect from their own community's misconfiguration. That is true and it is
   * not a reason to refuse the report: the person who hits a bug is usually the
   * member it happened to, and routing them through an admin loses the detail
   * on the way -- or loses the report, when nobody passes it on. Triage is the
   * operator's job and happens after the fact; it should not be a condition of
   * being heard.
   *
   * `non_validated` and `disabled` are excluded, as everywhere: `RolesGuard` is
   * an allowlist, so a role absent here grants nothing.
   */
  @Post()
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN, UserRole.SYSTEM_ADMIN)
  file(@CurrentUser() user: User, @Req() req: Request, @Body() dto: CreateSystemBugDto) {
    return this.reports.fileBug(user, req.tenant!.id, dto);
  }

  /**
   * Screenshots for a report (Rob, 2026-10-04).
   *
   * Its own route rather than reusing `POST /feedback/images`, because the two
   * carry different guards: that one is any signed-in member of any community
   * including a demo, this one inherits `NonDemoTenantGuard` from the class.
   * Sharing the route would have meant a demo visitor uploading into the shared
   * board's storage.
   *
   * Files land in the same deployment-wide uploads directory, which is what
   * makes the path readable from every community -- the point, here.
   */
  @Post('images')
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN, UserRole.SYSTEM_ADMIN)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dest = process.env.UPLOAD_PATH ?? '/app/uploads';
          mkdirSync(dest, { recursive: true });
          cb(null, dest);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          // `report-` rather than `feedback-`: the two live in one directory
          // and belong to different boards with different audiences.
          cb(null, `report-${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb: FileFilterCallback) => {
        const okMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
          file.mimetype,
        );
        const okExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(
          extname(file.originalname).toLowerCase(),
        );
        // Both, not either: the extension decides the served Content-Type and
        // the mimetype is client-supplied, so trusting one alone lets the other
        // through.
        if (okMime && okExt) cb(null, true);
        else cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File): { url: string } {
    if (!file) throw new BadRequestException('No image provided');
    return { url: `/api/uploads/${file.filename}` };
  }

  /**
   * Reading stays with admins, which is the asymmetry worth keeping.
   *
   * The board carries every other community's operational detail in free text.
   * Filing is a member telling us something about their own experience; reading
   * is being shown what every other community has reported, which a member has
   * no need of and which widens the audience for that free text by the size of
   * the whole deployment.
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.SYSTEM_ADMIN, UserRole.AUTOMATION)
  list(@CurrentUser() user: User, @Req() req: Request) {
    return this.reports.listBugs({
      tenantId: req.tenant!.id,
      isRootTenant: req.tenant!.isRoot,
      role: user.role,
      // The column, not the role: the service account is flipped between roles
      // for testing, so a role check fails exactly when automation is in use.
      isServiceAccount: user.isServiceAccount,
    });
  }

  /**
   * Triage: status, the operator's note, and which release it shipped in.
   *
   * **`OperatorGuard`, which keys on `is_service_account` and not on the role.**
   * This was `SystemAdminGuard` (too strict -- exact role `system_admin`), then
   * `RootTenantGuard` + `@Roles(SYSTEM_ADMIN, AUTOMATION)`, which still failed
   * on stage because the service account is deliberately flipped to `admin` for
   * testing and was sitting there. See that guard for the rule CLAUDE.md states
   * twice and this route broke twice.
   *
   * A root-tenant admin who is not the service account is still refused, per
   * Rob: only the system admin interacts with this board.
   *
   * Automation is here because the workflow is Rob's: a phase pulls in the
   * reports it will cover, each becomes `resolved` as the code lands, and on
   * release each becomes `shipped` carrying the version. Doing that by hand for
   * every report in every release is the kind of step that silently stops
   * happening.
   */
  @Patch(':id')
  // The coarse filter. `ADMIN` is listed because the service account is flipped
  // to it for testing -- `OperatorGuard` below is what actually decides, and it
  // refuses a root-tenant admin who is not the service account.
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.AUTOMATION, UserRole.ADMIN)
  @UseGuards(OperatorGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSystemBugDto) {
    return this.reports.updateBug(id, dto);
  }
}
