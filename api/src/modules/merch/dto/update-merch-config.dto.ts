import { IsOptional, IsUrl, ValidateIf } from 'class-validator';

export class UpdateMerchConfigDto {
  @IsUrl()
  @IsOptional()
  storeUrl?: string;

  @ValidateIf((o: UpdateMerchConfigDto) => o.foundingBearProductUrl !== null)
  @IsUrl()
  @IsOptional()
  foundingBearProductUrl?: string | null;
}
