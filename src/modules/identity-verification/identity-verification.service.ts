import { HttpStatus, Injectable } from '@nestjs/common';
import { IdentityVerification, IdentityVerificationType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { isValidTransition } from './identity-verification.transitions';

// Foundation for the KYC domain only (Phase 1 scope - see LEARNING.md /
// README Phase 1 notes). No controller is wired up yet: nothing in Phase 1
// triggers a real verification (that arrives with the PG application flow
// in a later phase). What matters now is that the *shape* of this domain -
// separate from User, separate from authentication, reusable across PGs -
// exists so later phases attach to it instead of bolting KYC state onto
// User or Tenant.
@Injectable()
export class IdentityVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  // Starts (or reuses) a verification for a user + type. If a still-valid
  // VERIFIED record already exists, it is returned as-is rather than
  // creating a duplicate PENDING one - this is what lets a user who moves
  // from PG A to PG B skip re-verification by default (see spec: identity
  // verification reuse). A specific PG requiring additional verification is
  // a policy decision for the PG-application domain in a later phase to
  // make explicitly (e.g. by calling `start` again with `force: true`),
  // not something this service assumes.
  async start(
    userId: string,
    verificationType: IdentityVerificationType,
    options: { provider?: string; force?: boolean } = {},
  ): Promise<IdentityVerification> {
    if (!options.force) {
      const existing = await this.prisma.identityVerification.findFirst({
        where: { userId, verificationType, status: 'VERIFIED' },
        orderBy: { createdAt: 'desc' },
      });
      if (
        existing &&
        (!existing.expiresAt || existing.expiresAt > new Date())
      ) {
        return existing;
      }
    }

    return this.prisma.identityVerification.create({
      data: {
        userId,
        verificationType,
        provider: options.provider,
        status: 'PENDING',
      },
    });
  }

  async transition(
    id: string,
    to: IdentityVerification['status'],
    updates: { providerReference?: string; expiresAt?: Date } = {},
  ): Promise<IdentityVerification> {
    const record = await this.prisma.identityVerification.findUnique({
      where: { id },
    });
    if (!record) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        'Identity verification record not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!isValidTransition(record.status, to)) {
      throw new AppException(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot transition identity verification from ${record.status} to ${to}.`,
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.identityVerification.update({
      where: { id },
      data: {
        status: to,
        providerReference: updates.providerReference,
        expiresAt: updates.expiresAt,
        verifiedAt: to === 'VERIFIED' ? new Date() : record.verifiedAt,
      },
    });
  }
}
