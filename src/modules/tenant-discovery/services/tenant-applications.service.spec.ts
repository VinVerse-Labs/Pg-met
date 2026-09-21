import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { PublicDiscoveryService } from './public-discovery.service';
import { ApplicationActivityService } from './application-activity.service';
import { TenantApplicationsService } from './tenant-applications.service';

function buildDto(overrides: Partial<any> = {}) {
  return {
    fullName: 'Jane Doe',
    phone: '98765 43210',
    email: 'Jane@Example.com',
    ...overrides,
  };
}

describe('TenantApplicationsService', () => {
  let service: TenantApplicationsService;
  let prisma: any;
  let memberships: { getActiveMembership: jest.Mock };
  let discovery: { assertApplicable: jest.Mock };
  let activity: { record: jest.Mock };
  let eventBus: { emit: jest.Mock };

  function mockTx(created: any) {
    const tx = {
      tenantApplication: { create: jest.fn().mockResolvedValue(created) },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    return tx;
  }

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      tenantApplication: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      property: { findUnique: jest.fn() },
    };
    memberships = { getActiveMembership: jest.fn() };
    discovery = { assertApplicable: jest.fn() };
    activity = { record: jest.fn() };
    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new TenantApplicationsService(
      prisma,
      memberships as unknown as MembershipsService,
      discovery as unknown as PublicDiscoveryService,
      activity as unknown as ApplicationActivityService,
      eventBus as unknown as DomainEventBusService,
    );
  });

  describe('create', () => {
    it('normalizes phone/email and auto-links an authenticated applicant', async () => {
      discovery.assertApplicable.mockResolvedValue({
        organizationId: 'org-1',
        listingId: 'listing-1',
      });
      const tx = mockTx({
        id: 'app-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        status: 'SUBMITTED',
      });

      await service.create('prop-1', buildDto(), 'applicant-1');

      expect(tx.tenantApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicantUserId: 'applicant-1',
            phone: '9876543210',
            email: 'jane@example.com',
          }),
        }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith('APPLICATION_SUBMITTED', {
        applicationId: 'app-1',
      });
    });

    it('allows a guest applicant with applicantUserId null', async () => {
      discovery.assertApplicable.mockResolvedValue({
        organizationId: 'org-1',
        listingId: null,
      });
      const tx = mockTx({ id: 'app-2', status: 'SUBMITTED' });

      await service.create('prop-1', buildDto(), null);

      expect(tx.tenantApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ applicantUserId: null }),
        }),
      );
    });

    it('translates the partial-unique-index P2002 into a generic APPLICATION_ALREADY_EXISTS, never leaking the phone', async () => {
      discovery.assertApplicable.mockResolvedValue({
        organizationId: 'org-1',
        listingId: 'listing-1',
      });
      const p2002 = new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: {
          target: 'tenant_applications_active_applicant_property_unique',
        },
      });
      prisma.$transaction.mockRejectedValue(p2002);

      await expect(
        service.create('prop-1', buildDto(), 'applicant-1'),
      ).rejects.toMatchObject({ code: ErrorCode.APPLICATION_ALREADY_EXISTS });
    });

    it('rejects submission when the property is not currently PUBLISHED/ACTIVE', async () => {
      discovery.assertApplicable.mockRejectedValue(
        Object.assign(new Error('not listable'), {
          code: ErrorCode.PROPERTY_NOT_LISTABLE,
        }),
      );

      await expect(
        service.create('prop-1', buildDto(), null),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_LISTABLE });
    });
  });

  describe('getApplicantApplicationOrThrow (BOLA)', () => {
    it('404s for an application belonging to a different applicant', async () => {
      prisma.tenantApplication.findFirst.mockResolvedValue(null);

      await expect(
        service.getApplicantApplicationOrThrow(
          { id: 'someone-else' } as any,
          'app-1',
        ),
      ).rejects.toMatchObject({ code: ErrorCode.APPLICATION_NOT_FOUND });
      expect(prisma.tenantApplication.findFirst).toHaveBeenCalledWith({
        where: { id: 'app-1', applicantUserId: 'someone-else' },
      });
    });
  });

  describe('getOrgApplicationOrThrow (cross-organization isolation)', () => {
    it('404s when the caller has no active membership in the owning organization', async () => {
      prisma.tenantApplication.findFirst.mockResolvedValue({
        id: 'app-1',
        organizationId: 'org-A',
      });
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.getOrgApplicationOrThrow(
          { id: 'user-in-org-B', platformRole: 'USER' } as any,
          'app-1',
        ),
      ).rejects.toMatchObject({ code: ErrorCode.APPLICATION_NOT_FOUND });
    });

    it('allows SUPER_ADMIN unconditionally', async () => {
      prisma.tenantApplication.findFirst.mockResolvedValue({
        id: 'app-1',
        organizationId: 'org-A',
      });

      const result = await service.getOrgApplicationOrThrow(
        { id: 'admin-1', platformRole: 'SUPER_ADMIN' } as any,
        'app-1',
      );
      expect(result.id).toBe('app-1');
      expect(memberships.getActiveMembership).not.toHaveBeenCalled();
    });
  });
});
