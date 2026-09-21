import { ApiProperty } from '@nestjs/swagger';
import { Menu, MenuItem, MenuStatus } from '@prisma/client';
import { MenuItemResponseDto } from './menu-item-response.dto';

export class MenuResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty({ example: '2026-10-01' })
  date!: string;

  @ApiProperty({ enum: MenuStatus })
  status!: MenuStatus;

  @ApiProperty({ type: [MenuItemResponseDto] })
  items!: MenuItemResponseDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(entity: Menu & { items?: MenuItem[] }): MenuResponseDto {
    const dto = new MenuResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.date = entity.date.toISOString().slice(0, 10);
    dto.status = entity.status;
    dto.items = (entity.items ?? []).map(MenuItemResponseDto.fromEntity);
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
