import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  /**
   * Optional as of v2-14, and NOT because registration got easier.
   *
   * Registration is invite-gated everywhere except the demo community, where
   * self-registration is the point. The gate therefore cannot live here any
   * more: this class cannot see which tenant the request resolved to, and a
   * required field would have refused the demo's only signup path before any
   * code that knows about the demo ran. `AuthService.registerWithPassword`
   * refuses an absent token with the same `no_invite` the OAuth paths give,
   * unless the resolved tenant carries `is_demo`.
   */
  @IsOptional()
  @IsString()
  inviteToken?: string;

  @IsString()
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
