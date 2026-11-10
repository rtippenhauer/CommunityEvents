import { Controller, Get, UseGuards } from '@nestjs/common';
import { AvatarsService, AvatarManifestEntry } from './avatars.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * The member-facing avatar picker (v2-47).
 *
 * **Guarded, where it used to be public.** The old comment said the picker
 * "needs the list before a member is fully authenticated, same as it did when
 * this was a static /avatars/manifest.json file". That stopped being true: the
 * only two callers are `profile-settings` and `admin-settings`, both behind a
 * session, and nothing on the registration, verification or login path reads
 * it. Left unguarded once the table was scoped it would still have served one
 * community's preset labels and file names to anyone who knew its host, which
 * is a smaller leak than the global table was but a leak nobody needs.
 */
@Controller('avatars')
@UseGuards(JwtAuthGuard)
export class AvatarsController {
  constructor(private readonly avatarsService: AvatarsService) {}

  @Get('manifest')
  getManifest(): Promise<AvatarManifestEntry[]> {
    return this.avatarsService.getManifest();
  }
}
