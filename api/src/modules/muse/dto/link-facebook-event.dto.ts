import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LinkFacebookEventDto {
  /**
   * The Facebook group this event was posted in, e.g. `Gem City Bears`.
   *
   * Optional, and omitting it on a repeat link leaves the stored group alone
   * rather than clearing it -- the same "omitted means leave it" rule the
   * credential writes follow. Clearing a group would lose the only label an
   * admin has for which list a Facebook event belongs to.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  group?: string;
}
