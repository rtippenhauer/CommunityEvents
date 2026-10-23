import { IsInt, Min } from 'class-validator';

export class LinkFacebookAccountDto {
  /** The member this Facebook person is. Validated against the community. */
  @IsInt()
  @Min(1)
  userId!: number;
}
