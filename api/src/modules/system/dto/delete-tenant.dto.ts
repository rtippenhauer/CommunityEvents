import { IsString } from 'class-validator';

/**
 * Confirmation for an irreversible delete.
 *
 * The domain is retyped rather than a boolean flag being set, because a boolean
 * is something a client can send by accident and a domain is not -- it is the
 * one field an operator cannot supply without having read which community they
 * are about to destroy. Checked against the stored domain server-side; the
 * dialog asking for it is a convenience, not the control.
 */
export class DeleteTenantDto {
  @IsString()
  confirmDomain!: string;
}
