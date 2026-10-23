import { IsIn, IsOptional } from 'class-validator';

export class FacebookAccountsQueryDto {
  /**
   * Which tab. Omitted means every status.
   *
   * `not_member` is spelled as the column is, not as the screen reads it ("Not
   * a member") -- a query parameter is part of an API and should match the
   * stored value rather than the label, which is free to be reworded.
   */
  @IsOptional()
  @IsIn(['unmatched', 'linked', 'not_member'])
  status?: 'unmatched' | 'linked' | 'not_member';
}
