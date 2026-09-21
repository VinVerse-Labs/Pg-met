import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PushDevicesService } from '../services/push-devices.service';
import { RegisterPushDeviceDto } from '../dto/register-push-device.dto';
import { PushDeviceResponseDto } from '../dto/push-device-response.dto';

// Ready for the React Native/Expo app to call directly (spec section
// 53/57) - `provider` defaults to EXPO but is never hardcoded elsewhere
// in the notification pipeline.
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/notifications/devices')
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  @Get()
  @ApiOperation({ summary: 'List the caller’s own registered push devices.' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PushDeviceResponseDto[]> {
    return this.devices.findForUser(user);
  }

  @Post()
  @ApiOperation({
    summary:
      'Register (or re-register) a push token. Re-registering the same token updates it in place.',
  })
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushDeviceDto,
  ): Promise<PushDeviceResponseDto> {
    return this.devices.register(user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of the caller’s own devices.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.devices.remove(user, id);
  }
}
