import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PushDevice } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { RegisterPushDeviceDto } from '../dto/register-push-device.dto';
import { PushDeviceResponseDto } from '../dto/push-device-response.dto';

@Injectable()
export class PushDevicesService {
  private readonly logger = new Logger(PushDevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Token rotation (spec section 55): re-registering the same
  // (provider, token) updates the existing row in place - including
  // reassigning `userId` if the same physical token is now presented by
  // a different authenticated user (a device that was logged out and
  // logged back in as someone else) - rather than raising a unique
  // violation or accumulating duplicate rows for what is, at the gateway
  // level, the exact same destination.
  async register(
    user: AuthenticatedUser,
    dto: RegisterPushDeviceDto,
  ): Promise<PushDeviceResponseDto> {
    const provider = dto.provider ?? 'EXPO';
    const existing = await this.prisma.pushDevice.findUnique({
      where: {
        push_devices_provider_token_unique: { provider, token: dto.token },
      },
    });

    let device: PushDevice;
    if (existing) {
      device = await this.prisma.pushDevice.update({
        where: { id: existing.id },
        data: {
          userId: user.id,
          platform: dto.platform,
          deviceId: dto.deviceId ?? null,
          appVersion: dto.appVersion ?? null,
          isActive: true,
          lastSeenAt: new Date(),
        },
      });
    } else {
      device = await this.prisma.pushDevice.create({
        data: {
          userId: user.id,
          platform: dto.platform,
          provider,
          token: dto.token,
          deviceId: dto.deviceId ?? null,
          appVersion: dto.appVersion ?? null,
        },
      });
    }
    this.logger.log(
      `PUSH_DEVICE_REGISTERED device=${device.id} user=${user.id} platform=${device.platform}`,
    );
    return PushDeviceResponseDto.fromEntity(device);
  }

  async findForUser(user: AuthenticatedUser): Promise<PushDeviceResponseDto[]> {
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: user.id },
      orderBy: { lastSeenAt: 'desc' },
    });
    return devices.map(PushDeviceResponseDto.fromEntity);
  }

  // BOLA-safe: scoped to userId in the WHERE clause, never "load then
  // check" (spec section 54 - cross-user access is 404, matching every
  // other resource-isolation convention in this project).
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const result = await this.prisma.pushDevice.deleteMany({
      where: { id, userId: user.id },
    });
    if (result.count === 0) {
      throw new AppException(
        ErrorCode.PUSH_DEVICE_NOT_FOUND,
        'Push device not found.',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
