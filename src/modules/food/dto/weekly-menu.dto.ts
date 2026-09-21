import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { MenuItemInputDto } from './menu-item-input.dto';

export class WeeklyMenuDayDto {
  @ApiProperty({ example: '2026-10-01', description: 'YYYY-MM-DD' })
  @IsDateString()
  date!: string;

  @ApiProperty({ type: [MenuItemInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuItemInputDto)
  items!: MenuItemInputDto[];
}

// The bulk weekly-update body (spec section 27): up to 7 date entries,
// each independently valid. FoodMenusService.putWeek wraps every day's
// upsert-plus-item-replace in one transaction, so a request intended to
// update a whole week can never leave some days changed and others not
// (spec: "do not partially update a week if the operation is intended to
// be atomic").
export class WeeklyMenuDto {
  @ApiProperty({ type: [WeeklyMenuDayDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyMenuDayDto)
  days!: WeeklyMenuDayDto[];
}
