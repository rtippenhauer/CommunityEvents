import { IsInt, Min } from 'class-validator';

export class AddToGoingDto {
  /**
   * The member an organiser is adding. An existing account only -- this is not
   * a way to create one, and a walk-in who has no account goes through the
   * walk-in route beside it.
   */
  @IsInt()
  @Min(1)
  userId!: number;
}
