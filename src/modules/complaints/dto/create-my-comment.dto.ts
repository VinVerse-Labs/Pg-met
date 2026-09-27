import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// No `visibility`: a tenant comment is always PUBLIC. Sending the field is
// rejected by the global forbidNonWhitelisted ValidationPipe.
export class CreateMyCommentDto {
  @ApiProperty({ example: 'The tap is still leaking this morning.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
