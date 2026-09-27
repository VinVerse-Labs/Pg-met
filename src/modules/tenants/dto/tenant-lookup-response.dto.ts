import { ApiProperty } from '@nestjs/swagger';

// What an OWNER/MANAGER sees when resolving a tenant code before check-in:
// just enough to confirm "this is the person in front of me" (their account
// name) - never their phone, email or any other account field.
export class TenantLookupResponseDto {
  @ApiProperty()
  tenantId!: string;

  @ApiProperty({ example: 'TN-3K7Q-9XZ2' })
  code!: string;

  @ApiProperty({ description: "The tenant's account name." })
  name!: string;
}
