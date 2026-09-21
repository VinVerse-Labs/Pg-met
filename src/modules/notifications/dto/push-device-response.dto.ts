import { ApiProperty } from '@nestjs/swagger';
import { PushDevice, PushPlatform, PushTokenProvider } from '@prisma/client';

// The raw push token is deliberately never included (spec section 54:
// "do not expose push tokens in normal user-facing API responses unless
// required") - the client already knows its own token; there is no
// legitimate reason to echo it back.
export class PushDeviceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: PushPlatform })
  platform!: PushPlatform;

  @ApiProperty({ enum: PushTokenProvider })
  provider!: PushTokenProvider;

  @ApiProperty({ nullable: true, type: String })
  deviceId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  appVersion!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  lastSeenAt!: Date;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(entity: PushDevice): PushDeviceResponseDto {
    const dto = new PushDeviceResponseDto();
    dto.id = entity.id;
    dto.platform = entity.platform;
    dto.provider = entity.provider;
    dto.deviceId = entity.deviceId;
    dto.appVersion = entity.appVersion;
    dto.isActive = entity.isActive;
    dto.lastSeenAt = entity.lastSeenAt;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}
