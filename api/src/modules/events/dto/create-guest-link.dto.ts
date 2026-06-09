import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGuestLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  recipientEmail?: string;
}
