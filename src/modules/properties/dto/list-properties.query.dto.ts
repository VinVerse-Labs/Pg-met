import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ListPropertiesQueryDto {
  @ApiPropertyOptional({
    description:
      'Restrict the list to one organization. Subject to the same membership check as every other property endpoint - an organizationId the caller cannot access returns 404, exactly like GET /organizations/:id.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
