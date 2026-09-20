import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Deliberately has no `price`/`currency` field at all - see
// SaasPlansService.adminUpdate's doc comment. Changing the price means
// creating a new plan (POST), never PATCHing this one.
export class UpdateSaasPlanDto {
  @ApiPropertyOptional({ example: 'Pro (renamed)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
