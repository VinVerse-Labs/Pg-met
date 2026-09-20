import { ApiProperty } from '@nestjs/swagger';
import { ResidencyResponseDto } from './residency-response.dto';
import { BedAllocationResponseDto } from './bed-allocation-response.dto';

// Returned by both check-in and check-out - each action changes exactly
// these two records atomically (see ResidenciesService), so the response
// always shows both the resulting residency state and the allocation that
// was just created/ended.
export class ResidencyActionResponseDto {
  @ApiProperty({ type: ResidencyResponseDto })
  residency!: ResidencyResponseDto;

  @ApiProperty({ type: BedAllocationResponseDto })
  allocation!: BedAllocationResponseDto;
}
