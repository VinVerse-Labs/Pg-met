import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

// The ONLY field a PATCH may change. No `status` field exists here on
// purpose (spec sections 17/18): lifecycle transitions are action-based
// (POST .../check-in, POST .../check-out), never a side effect of an
// arbitrary metadata PATCH - a client can never send `{"status":"ACTIVE"}`
// to skip check-in. `tenantId`/`propertyId`/`startDate` are also excluded:
// they're structural to the residency and not "safe editable metadata".
export class UpdateResidencyDto {
  @ApiProperty({ description: 'Revised planned move-out date (ISO 8601).' })
  @IsDateString()
  expectedEndDate!: string;
}
