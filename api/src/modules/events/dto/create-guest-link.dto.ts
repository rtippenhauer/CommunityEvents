import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGuestLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientName?: string;
}
