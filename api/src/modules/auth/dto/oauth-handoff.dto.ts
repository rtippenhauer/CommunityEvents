import { IsString, Length } from 'class-validator';

/**
 * The single-use ticket the OAuth callback handed to this community's host
 * (REQ-TENANT-01.8).
 *
 * Bounded rather than merely required: the value is hashed and looked up, and
 * an unbounded string is an unbounded hash input on an unauthenticated route.
 * 32 random bytes are 43 base64url characters; the range leaves room for a
 * format change without being a place to put a payload.
 */
export class OAuthHandoffDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}
