import { IsOptional, IsUrl, ValidateIf } from 'class-validator';

export class UpdateMerchConfigDto {
  @ValidateIf((o: UpdateMerchConfigDto) => o.storeUrl !== null)
  @IsUrl()
  @IsOptional()
  storeUrl?: string | null;

  @ValidateIf((o: UpdateMerchConfigDto) => o.foundingBearProductUrl !== null)
  @IsUrl()
  @IsOptional()
  foundingBearProductUrl?: string | null;
}
