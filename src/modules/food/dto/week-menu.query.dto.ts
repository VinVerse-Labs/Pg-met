import { ApiProperty } from '@nestjs/swagger';
import { IsCalendarDate } from '../../../common/validation/calendar';

// Validated at the boundary so a missing, malformed or impossible date is a
// 400 VALIDATION_FAILED - never an `Invalid Date` reaching Prisma (a 500).
export class WeekMenuQueryDto {
  @ApiProperty({
    example: '2026-09-28',
    description: 'First day of the 7-day window (YYYY-MM-DD).',
  })
  @IsCalendarDate()
  startDate!: string;
}
