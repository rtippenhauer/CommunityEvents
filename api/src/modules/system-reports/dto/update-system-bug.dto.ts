import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeedbackStatus } from '../../../database/enums';

/**
 * The operator's half: triage, not content.
 *
 * `title` and `body` are deliberately absent. They are the reporter's words,
 * and the operator editing them would rewrite what another community's admin
 * said while leaving their name on it.
 */
export class UpdateSystemBugDto {
  @IsEnum(FeedbackStatus)
  @IsOptional()
  status?: FeedbackStatus;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  adminNote?: string;

  /**
   * The release this shipped in, named by **version** rather than row id.
   *
   * Automation knows "2.0.0"; it does not know what primary key that release
   * took on this particular deployment, and the two differ between stage and
   * production. `releases.version` is unique, so the version is a stable
   * identifier across deployments in a way an id is not -- which is the same
   * reason the note importer keys on it.
   *
   * An empty string clears the link, for a release that gets unpublished.
   */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  shippedInVersion?: string;
}
