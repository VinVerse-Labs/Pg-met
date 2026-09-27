import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { UsersService } from '../../users/users.service';
import { TenantApplicationsService } from './tenant-applications.service';
import { tenantCodeFromId } from '../../tenants/tenant-code';
import { ApplicationConversionService } from './application-conversion.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'manager-1',
    name: 'Manager',
    email: 'manager@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function buildApplication(overrides: Partial<any> = {}) {
  return {
    id: 'app-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    applicantUserId: 'applicant-1',
    fullName: 'Jane Doe',
    phone: '+911234567890',
    email: null,
    status: 'APPROVED',
    ...overrides,
  };
}

describe('ApplicationConversionService', () => {
  let service: ApplicationConversionService;
  let prisma: any;
  let tx: any;
  let users: { create: jest.Mock };
  let applications: { getOrgApplicationOrThrow: jest.Mock };

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      tenantApplication: {
        updateMany: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        upsert: jest.fn(),
      },
    };
    prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    users = { create: jest.fn() };
    applications = { getOrgApplicationOrThrow: jest.fn() };

    service = new ApplicationConversionService(
      prisma,
      users as unknown as UsersService,
      applications as unknown as TenantApplicationsService,
    );
  });

  it('rejects an application that is not yet APPROVED', async () => {
    applications.getOrgApplicationOrThrow.mockResolvedValue(
      buildApplication({ status: 'UNDER_REVIEW' }),
    );

    await expect(
      service.startOnboarding(buildUser(), 'app-1'),
    ).rejects.toMatchObject({ code: ErrorCode.APPLICATION_INVALID_STATE });
  });

  it('reuses an existing Tenant row for an already-linked applicant, never creating a duplicate', async () => {
    applications.getOrgApplicationOrThrow.mockResolvedValue(buildApplication());
    tx.tenantApplication.updateMany.mockResolvedValue({ count: 1 });
    tx.tenant.findUnique.mockResolvedValue({
      id: 'a1111111-1111-4111-8111-111111111111',
      userId: 'applicant-1',
    });
    tx.tenant.upsert.mockResolvedValue({
      id: 'a1111111-1111-4111-8111-111111111111',
      userId: 'applicant-1',
    });

    const result = await service.startOnboarding(buildUser(), 'app-1');

    expect(result).toEqual({
      tenantId: 'a1111111-1111-4111-8111-111111111111',
      tenantCode: tenantCodeFromId('a1111111-1111-4111-8111-111111111111'),
      applicationId: 'app-1',
      reused: true,
    });
    expect(users.create).not.toHaveBeenCalled();
  });

  it('creates a new phone-only User + Tenant for a guest applicant (no applicantUserId)', async () => {
    applications.getOrgApplicationOrThrow.mockResolvedValue(
      buildApplication({ applicantUserId: null }),
    );
    tx.tenantApplication.updateMany.mockResolvedValue({ count: 1 });
    users.create.mockResolvedValue({ id: 'new-user-1' });
    tx.tenant.findUnique.mockResolvedValue(null);
    tx.tenant.upsert.mockResolvedValue({
      id: 'b2222222-2222-4222-8222-222222222222',
      userId: 'new-user-1',
    });

    const result = await service.startOnboarding(buildUser(), 'app-1');

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+911234567890' }),
    );
    expect(result).toEqual({
      tenantId: 'b2222222-2222-4222-8222-222222222222',
      tenantCode: tenantCodeFromId('b2222222-2222-4222-8222-222222222222'),
      applicationId: 'app-1',
      reused: false,
    });
  });

  it('resolves deterministically to the same Tenant when the concurrency guard loses the race (the advisory lock has already made it wait for the winner to commit)', async () => {
    applications.getOrgApplicationOrThrow.mockResolvedValue(buildApplication());
    // A concurrent caller already claimed onboardingStartedAt and
    // committed its transaction before this one acquired the lock.
    tx.tenantApplication.updateMany.mockResolvedValue({ count: 0 });
    tx.tenant.findUniqueOrThrow.mockResolvedValue({
      id: 'c3333333-3333-4333-8333-333333333333',
      userId: 'applicant-1',
    });

    const result = await service.startOnboarding(buildUser(), 'app-1');

    expect(result).toEqual({
      tenantId: 'c3333333-3333-4333-8333-333333333333',
      tenantCode: tenantCodeFromId('c3333333-3333-4333-8333-333333333333'),
      applicationId: 'app-1',
      reused: true,
    });
    expect(tx.tenant.upsert).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalled();
  });
});
