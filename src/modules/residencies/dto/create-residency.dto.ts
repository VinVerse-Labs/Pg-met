import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

// No propertyId field - it comes from the URL (POST
// /properties/:propertyId/residencies), same convention as CreateRoomDto/
// CreateBedDto. No bedId either: creating a residency only schedules a
// stay (status PENDING) - it deliberately does NOT allocate a bed. That is
// check-in's job (see ResidenciesService.checkIn), kept as a separate,
// explicit action per spec section 19.
export class CreateResidencyDto {
  @ApiProperty({ description: 'An existing Tenant id.' })
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ description: 'Intended/agreed move-in date (ISO 8601).' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({
    required: false,
    description: 'Planned move-out date (ISO 8601).',
  })
  @IsOptional()
  @IsDateString()
  expectedEndDate?: string;
}
