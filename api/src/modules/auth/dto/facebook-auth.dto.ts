import { IsOptional, IsString } from 'class-validator';

export class FacebookAuthDto {
  @IsString()
  accessToken: string;

  @IsOptional()
  @IsString()
  inviteToken?: string;
}
