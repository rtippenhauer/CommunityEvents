import { IsInt, IsPositive } from 'class-validator';

export class AddWalkinDto {
  @IsInt()
  @IsPositive()
  userId: number;
}
