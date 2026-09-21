import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { MenuItemInputDto } from './menu-item-input.dto';

// A full-replace update of this one day's items only - never touches any
// other menu row (spec: "updating Monday must not affect Tuesday-Sunday").
// DRAFT only; a PUBLISHED/CANCELLED menu must be explicitly reopened via
// its own lifecycle before its items can change again (see
// FoodMenusService.replaceItems).
export class UpdateMenuDto {
  @ApiProperty({ type: [MenuItemInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuItemInputDto)
  items!: MenuItemInputDto[];
}
