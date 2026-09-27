import { ApiProperty } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { tenantCodeFromId } from '../tenant-code';

// Deliberately just id/userId/createdAt - Tenant carries no name/phone/
// email/status of its own (see the model's doc comment in schema.prisma),
// so there is nothing else to expose. Never returns anything from `User`
// (no passwordHash, no auth fields) - this DTO is built from the Tenant
// row alone.
export class TenantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'Short display form of the id (e.g. TN-3K7Q-9XZ2) to share with a property team.',
  })
  code!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(tenant: Tenant): TenantResponseDto {
    const dto = new TenantResponseDto();
    dto.id = tenant.id;
    dto.code = tenantCodeFromId(tenant.id);
    dto.userId = tenant.userId;
    dto.createdAt = tenant.createdAt;
    return dto;
  }
}
