import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// bedId only - no roomId, no propertyId. This is deliberate: the room and
// property a bed belongs to are derived from the database relation on the
// bed itself (see ResidenciesService.checkIn), never taken as separate
// client input that would need to be cross-checked for consistency. A
// client cannot supply a mismatched room/property because there is no
// field for one - see spec section 14.
export class CheckInDto {
  @ApiProperty({
    description:
      "The bed to allocate. Must belong to the residency's property.",
  })
  @IsUUID()
  bedId!: string;
}
