import { Controller, Get } from '@nestjs/common';
import { AvatarsService, AvatarManifestEntry } from './avatars.service';

// Public, unguarded — the login/profile avatar picker needs the list before a
// member is fully authenticated, same as it did when this was a static
// /avatars/manifest.json file.
@Controller('avatars')
export class AvatarsController {
  constructor(private readonly avatarsService: AvatarsService) {}

  @Get('manifest')
  getManifest(): Promise<AvatarManifestEntry[]> {
    return this.avatarsService.getManifest();
  }
}
