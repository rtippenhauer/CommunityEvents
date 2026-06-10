import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePublicRsvpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsEmail()
  @MaxLength(255)
  email: string;
}
