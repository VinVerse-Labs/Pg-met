import { ApiProperty } from '@nestjs/swagger';

// Deliberately minimal - the conversion step only ever hands back the
// tenantId the owner now uses with the existing Phase 4 `POST
// /residencies` endpoint. It is never a Residency/BedAllocation response
// (this phase creates neither - see ApplicationConversionService docs).
export class ConversionResponseDto {
  @ApiProperty() tenantId!: string;
  @ApiProperty() applicationId!: string;
  @ApiProperty({ description: 'true if an existing Tenant row was reused.' })
  reused!: boolean;
}
