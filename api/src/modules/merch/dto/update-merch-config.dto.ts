import { IsOptional, IsUrl, MaxLength, ValidateIf } from 'class-validator';

export class UpdateMerchConfigDto {
  @ValidateIf((o: UpdateMerchConfigDto) => o.storeUrl !== null)
  @IsUrl()
  @MaxLength(500)
  @IsOptional()
  storeUrl?: string | null;

  @ValidateIf((o: UpdateMerchConfigDto) => o.foundingBearProductUrl !== null)
  @IsUrl()
  @MaxLength(500)
  @IsOptional()
  foundingBearProductUrl?: string | null;
}
