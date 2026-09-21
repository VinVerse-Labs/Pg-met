import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { TenantApplicationsService } from './tenant-applications.service';
import { ConversionResponseDto } from '../dto/conversion-response.dto';

const REVIEW_ROLES = ['OWNER', 'MANAGER'] as const;

// The explicit, separate onboarding step (spec: "NOT automatic on
// approval"). This service's job ends at "here is the tenantId" - it
// never calls ResidenciesService.checkIn and never creates a
// BedAllocation/Invoice/Payment. The actual move-in remains a manual,
// separate call to the existing Phase 4 `POST /residencies` endpoint by
// the owner/manager, using the tenantId this returns. Keeping this
// boundary explicit (rather than folding check-in in here "for
// convenience") is what keeps Phase 4's own atomicity/concurrency
// guarantees (one ACTIVE residency per tenant, one ACTIVE allocation per
// bed) as the single place that logic lives.
@Injectable()
export class ApplicationConversionService {
  private readonly logger = new Logger(ApplicationConversionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly applications: TenantApplicationsService,
  ) {}

  async startOnboarding(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<ConversionResponseDto> {
    const application = await this.applications.getOrgApplicationOrThrow(
      user,
      applicationId,
      REVIEW_ROLES,
    );
    if (application.status !== 'APPROVED') {
      throw new AppException(
        ErrorCode.APPLICATION_INVALID_STATE,
        'Only an APPROVED application can start onboarding.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Concurrency guard: the whole claim-and-convert sequence runs inside
    // a transaction opened with a Postgres advisory lock keyed by
    // applicationId (`pg_advisory_xact_lock`). This is what makes the
    // guarantee airtight under genuine concurrency - a conditional
    // `updateMany` on `onboardingStartedAt IS NULL` alone (the pattern
    // every other lifecycle transition in this codebase uses) still
    // leaves a window where the *losing* caller can observe
    // "already claimed" before the winner has finished creating the
    // Tenant row, and would otherwise have to answer with a transient
    // error instead of the actual tenantId. The lock instead makes the
    // loser's transaction wait for the winner's to fully commit, so it
    // always sees a completed conversion, never a half-finished one -
    // exactly one Tenant is created, and both concurrent callers resolve
    // to that same tenantId (see this phase's verification script for the
    // concurrency test proving this against real Postgres).
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${applicationId}))`;

      const claimed = await tx.tenantApplication.updateMany({
        where: {
          id: applicationId,
          status: 'APPROVED',
          onboardingStartedAt: null,
        },
        data: { onboardingStartedAt: new Date() },
      });

      if (claimed.count === 0) {
        // Another caller already completed the claim (and, since we just
        // waited on the same lock, has also finished converting) - reuse
        // its Tenant deterministically.
        if (!application.applicantUserId) {
          const fresh = await tx.tenantApplication.findUniqueOrThrow({
            where: { id: applicationId },
          });
          if (!fresh.applicantUserId) {
            throw new AppException(
              ErrorCode.APPLICATION_APPLICANT_NOT_LINKED,
              'This application has no linked applicant account yet.',
              HttpStatus.CONFLICT,
            );
          }
          const tenant = await tx.tenant.findUniqueOrThrow({
            where: { userId: fresh.applicantUserId },
          });
          return { tenantId: tenant.id, reused: true };
        }
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { userId: application.applicantUserId },
        });
        return { tenantId: tenant.id, reused: true };
      }

      let applicantUserId = application.applicantUserId;
      if (!applicantUserId) {
        // Guest applicant: this platform's own registration flow already
        // supports a phone-only account (AuthService.register requires
        // "either email or phone", not both) - reuse UsersService.create
        // directly rather than inventing a parallel account-creation
        // path. A duplicate phone across a genuine pre-existing account
        // raises P2002 on User.phone, translated by AllExceptionsFilter
        // to a generic 409 - acceptable here since it means a real
        // account with this phone already exists and should instead be
        // linked by logging in and re-submitting, out of scope for this
        // endpoint.
        const created = await this.users.create({
          name: application.fullName,
          phone: application.phone,
          email: application.email ?? undefined,
        });
        applicantUserId = created.id;
      }

      // Reuse an existing Tenant row if one already exists for this user
      // (spec: "never create a duplicate Tenant") - upsert on the unique
      // `userId` column, additionally serialized by the advisory lock
      // above against any other conversion racing on the same
      // application.
      const existingTenant = await tx.tenant.findUnique({
        where: { userId: applicantUserId },
      });
      const tenant = await tx.tenant.upsert({
        where: { userId: applicantUserId },
        update: {},
        create: { userId: applicantUserId },
      });

      if (!application.applicantUserId) {
        await tx.tenantApplication.update({
          where: { id: applicationId },
          data: { applicantUserId },
        });
      }

      return { tenantId: tenant.id, reused: !!existingTenant };
    });

    this.logger.log(
      `APPLICATION_ONBOARDING_STARTED application=${applicationId} tenant=${result.tenantId} by=${user.id}`,
    );
    return { tenantId: result.tenantId, applicationId, reused: result.reused };
  }
}
