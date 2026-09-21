import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Used both for an applicant's own visit *request* (no time - server
// ignores any time fields on that path, see PropertyVisitsService.request)
// and for an owner/manager's direct scheduling call, where both fields are
// required.
export class ScheduleVisitDto {
  @IsDateString()
  @IsNotEmpty()
  scheduledStartAt!: string;

  @IsDateString()
  @IsNotEmpty()
  scheduledEndAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RequestVisitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CancelVisitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
