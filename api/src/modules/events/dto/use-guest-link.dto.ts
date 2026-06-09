import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UseGuestLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  guestName?: string;
}
