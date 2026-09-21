import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// A minimal reference registration, never a file upload (spec: "do NOT
// build a complicated file-storage platform"). The client uploads the
// file itself somewhere (out of scope) and registers the resulting URL/
// metadata here - see ComplaintAttachmentsService for the server-side
// mimeType/size validation this DTO's own constraints only partially
// express (class-validator can't express "one of these three exact MIME
// strings" as cleanly as a service-level check with a clear error code).
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export class CreateAttachmentDto {
  @ApiProperty()
  @IsUrl({ require_protocol: true })
  url!: string;

  @ApiProperty({ example: 'leaking-tap.jpg' })
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ enum: ALLOWED_MIME_TYPES })
  @IsIn(ALLOWED_MIME_TYPES)
  mimeType!: string;

  @ApiProperty({ example: 245000, description: 'Size in bytes, max 10MB.' })
  @IsInt()
  @Min(1)
  @Max(MAX_SIZE_BYTES)
  size!: number;
}

export { ALLOWED_MIME_TYPES, MAX_SIZE_BYTES };
