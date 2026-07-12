import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCustomIconDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
