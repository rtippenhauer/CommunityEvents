import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Asking for a demo community (v2-14).
 *
 * The same three fields registration takes, and validated the same way, because
 * what this eventually creates is an ordinary first admin of an ordinary
 * community -- the password is hashed at request time and becomes that admin's.
 */
export class RequestDemoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
