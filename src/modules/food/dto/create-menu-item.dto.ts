import { MenuItemInputDto } from './menu-item-input.dto';

// Same shape as the shared item input - a dedicated class only so
// Swagger/consumers see a distinct operation-scoped name.
export class CreateMenuItemDto extends MenuItemInputDto {}
