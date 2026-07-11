import { IsDefined, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushKeysDto {
  @IsString() p256dh: string;
  @IsString() auth: string;
}

export class SubscribePushDto {
  @IsString() endpoint: string;
  // @ValidateNested() alone does not reject an undefined value — without
  // @IsDefined(), an omitted `keys` object reaches the controller as
  // undefined and crashes on `dto.keys.p256dh` instead of failing validation.
  @IsDefined() @ValidateNested() @Type(() => PushKeysDto) keys: PushKeysDto;
}
