import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { MenuItemInputDto } from './menu-item-input.dto';

export class CreateMenuDto {
  @ApiProperty({ example: '2026-10-01', description: 'YYYY-MM-DD' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ type: [MenuItemInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuItemInputDto)
  items?: MenuItemInputDto[];
}
