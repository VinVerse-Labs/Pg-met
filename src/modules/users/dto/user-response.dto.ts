import { ApiProperty } from '@nestjs/swagger';
import { PlatformRole, UserStatus } from '@prisma/client';

// The only shape of a User ever returned from an API response. Built
// explicitly field-by-field (never `return user` on a Prisma row) so a
// future column added to the User table - or a sensitive one like
// passwordHash - cannot accidentally become public API surface.
//
// platformRole is included so clients (notably PGMet Internal, the
// SUPER_ADMIN-only staff tool) can tell whether the authenticated user is
// a platform operator without probing /admin/* endpoints. It is not
// sensitive - it only ever distinguishes SUPER_ADMIN from the USER default.
export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ enum: PlatformRole })
  platformRole!: PlatformRole;

  static fromEntity(user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: UserStatus;
    platformRole: PlatformRole;
  }): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.name = user.name;
    dto.email = user.email;
    dto.phone = user.phone;
    dto.status = user.status;
    dto.platformRole = user.platformRole;
    return dto;
  }
}
