import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { NotificationsService } from './notifications.service';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationType } from '../enums/notification-type.enum';
import {
  ApplicationEventPayload,
  ComplaintEventPayload,
  FoodMenuEventPayload,
  FoodSubscriptionEventPayload,
  FoodSubscriptionPaymentEventPayload,
  InvoiceEventPayload,
  RentPaymentEventPayload,
  ResidencyEventPayload,
  SaasSubscriptionEventPayload,
  SaasSubscriptionPaymentEventPayload,
  VisitEventPayload,
} from '../types/notification-event.types';

// The single subscriber for every business event this phase supports
// (spec section 33/105) - business modules only ever call
// `DomainEventBusService.emit(NotificationType.X, { entityId })`
// (never `NotificationsService` directly), and every handler here
// re-reads the referenced entity from Postgres itself before resolving a
// recipient or rendering a template (spec section 66) - the payload is
// never trusted beyond "which row to look up."
@Injectable()
export class NotificationEventService implements OnModuleInit {
  private readonly logger = new Logger(NotificationEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: DomainEventBusService,
    private readonly notifications: NotificationsService,
    private readonly recipients: NotificationRecipientsService,
  ) {}

  onModuleInit(): void {
    this.eventBus.on<ResidencyEventPayload>(
      NotificationType.RESIDENCY_CHECKED_IN,
      (p) => this.onResidencyCheckedIn(p),
    );
    this.eventBus.on<ResidencyEventPayload>(
      NotificationType.RESIDENCY_CHECKED_OUT,
      (p) => this.onResidencyCheckedOut(p),
    );

    this.eventBus.on<InvoiceEventPayload>(
      NotificationType.RENT_INVOICE_ISSUED,
      (p) => this.onInvoiceIssued(p),
    );
    this.eventBus.on<InvoiceEventPayload>(
      NotificationType.RENT_INVOICE_OVERDUE,
      (p) => this.onInvoiceOverdue(p),
    );
    this.eventBus.on<RentPaymentEventPayload>(
      NotificationType.RENT_PAYMENT_SUCCESS,
      (p) => this.onRentPaymentSuccess(p),
    );
    this.eventBus.on<RentPaymentEventPayload>(
      NotificationType.RENT_PAYMENT_FAILED,
      (p) => this.onRentPaymentFailed(p),
    );

    this.eventBus.on<FoodMenuEventPayload>(
      NotificationType.FOOD_MENU_PUBLISHED,
      (p) => this.onFoodMenuChanged(p, NotificationType.FOOD_MENU_PUBLISHED),
    );
    this.eventBus.on<FoodMenuEventPayload>(
      NotificationType.FOOD_MENU_UPDATED,
      (p) => this.onFoodMenuChanged(p, NotificationType.FOOD_MENU_UPDATED),
    );
    this.eventBus.on<FoodSubscriptionEventPayload>(
      NotificationType.FOOD_SUBSCRIPTION_CREATED,
      (p) =>
        this.onFoodSubscriptionLifecycle(
          p,
          NotificationType.FOOD_SUBSCRIPTION_CREATED,
        ),
    );
    this.eventBus.on<FoodSubscriptionEventPayload>(
      NotificationType.FOOD_SUBSCRIPTION_PAUSED,
      (p) =>
        this.onFoodSubscriptionLifecycle(
          p,
          NotificationType.FOOD_SUBSCRIPTION_PAUSED,
        ),
    );
    this.eventBus.on<FoodSubscriptionEventPayload>(
      NotificationType.FOOD_SUBSCRIPTION_RESUMED,
      (p) =>
        this.onFoodSubscriptionLifecycle(
          p,
          NotificationType.FOOD_SUBSCRIPTION_RESUMED,
        ),
    );
    this.eventBus.on<FoodSubscriptionEventPayload>(
      NotificationType.FOOD_SUBSCRIPTION_CANCELLED,
      (p) =>
        this.onFoodSubscriptionLifecycle(
          p,
          NotificationType.FOOD_SUBSCRIPTION_CANCELLED,
        ),
    );
    this.eventBus.on<FoodSubscriptionEventPayload>(
      NotificationType.FOOD_SUBSCRIPTION_PAYMENT_DUE,
      (p) => this.onFoodSubscriptionPaymentDue(p),
    );
    this.eventBus.on<FoodSubscriptionPaymentEventPayload>(
      NotificationType.FOOD_SUBSCRIPTION_PAYMENT_SUCCESS,
      (p) => this.onFoodSubscriptionPaymentSuccess(p),
    );

    this.eventBus.on<ComplaintEventPayload>(
      NotificationType.COMPLAINT_CREATED,
      (p) => this.onComplaintCreated(p),
    );
    this.eventBus.on<ComplaintEventPayload>(
      NotificationType.COMPLAINT_ASSIGNED,
      (p) => this.onComplaintAssigned(p),
    );
    this.eventBus.on<ComplaintEventPayload & { newStatus?: string }>(
      NotificationType.COMPLAINT_STATUS_CHANGED,
      (p) => this.onComplaintStatusChanged(p),
    );
    this.eventBus.on<ComplaintEventPayload>(
      NotificationType.COMPLAINT_RESOLVED,
      (p) => this.onComplaintTerminal(p, NotificationType.COMPLAINT_RESOLVED),
    );
    this.eventBus.on<ComplaintEventPayload>(
      NotificationType.COMPLAINT_CLOSED,
      (p) => this.onComplaintTerminal(p, NotificationType.COMPLAINT_CLOSED),
    );

    this.eventBus.on<SaasSubscriptionEventPayload>(
      NotificationType.SAAS_SUBSCRIPTION_RENEWAL_DUE,
      (p) =>
        this.onSaasSubscriptionState(
          p,
          NotificationType.SAAS_SUBSCRIPTION_RENEWAL_DUE,
        ),
    );
    this.eventBus.on<SaasSubscriptionEventPayload>(
      NotificationType.SAAS_SUBSCRIPTION_SUSPENDED,
      (p) =>
        this.onSaasSubscriptionState(
          p,
          NotificationType.SAAS_SUBSCRIPTION_SUSPENDED,
        ),
    );
    this.eventBus.on<SaasSubscriptionPaymentEventPayload>(
      NotificationType.SAAS_SUBSCRIPTION_PAYMENT_SUCCESS,
      (p) =>
        this.onSaasSubscriptionPayment(
          p,
          NotificationType.SAAS_SUBSCRIPTION_PAYMENT_SUCCESS,
        ),
    );
    this.eventBus.on<SaasSubscriptionPaymentEventPayload>(
      NotificationType.SAAS_SUBSCRIPTION_PAYMENT_FAILED,
      (p) =>
        this.onSaasSubscriptionPayment(
          p,
          NotificationType.SAAS_SUBSCRIPTION_PAYMENT_FAILED,
        ),
    );

    this.eventBus.on<ApplicationEventPayload>(
      NotificationType.APPLICATION_SUBMITTED,
      (p) => this.onApplicationSubmitted(p),
    );
    this.eventBus.on<ApplicationEventPayload>(
      NotificationType.APPLICATION_REVIEW_STARTED,
      (p) => this.onApplicationReviewStarted(p),
    );
    this.eventBus.on<ApplicationEventPayload>(
      NotificationType.APPLICATION_APPROVED,
      (p) => this.onApplicationApproved(p),
    );
    this.eventBus.on<ApplicationEventPayload>(
      NotificationType.APPLICATION_REJECTED,
      (p) => this.onApplicationRejected(p),
    );
    this.eventBus.on<VisitEventPayload>(NotificationType.VISIT_SCHEDULED, (p) =>
      this.onVisitState(p, NotificationType.VISIT_SCHEDULED),
    );
    this.eventBus.on<VisitEventPayload>(
      NotificationType.VISIT_RESCHEDULED,
      (p) => this.onVisitState(p, NotificationType.VISIT_RESCHEDULED),
    );
    this.eventBus.on<VisitEventPayload>(NotificationType.VISIT_CANCELLED, (p) =>
      this.onVisitState(p, NotificationType.VISIT_CANCELLED),
    );
    this.eventBus.on<VisitEventPayload>(NotificationType.VISIT_NO_SHOW, (p) =>
      this.onVisitNoShow(p),
    );

    this.logger.log('NOTIFICATION_EVENT_HANDLERS_REGISTERED');
  }

  // ---------------------------------------------------------------------
  // Tenant discovery, applications & visits (Phase 12)
  // ---------------------------------------------------------------------

  private async onApplicationSubmitted(
    p: ApplicationEventPayload,
  ): Promise<void> {
    const application = await this.prisma.tenantApplication.findUnique({
      where: { id: p.applicationId },
      include: { property: true },
    });
    if (!application) return;
    const staffUserIds = await this.recipients.activeOrgMembersByRole(
      application.organizationId,
      ['OWNER', 'MANAGER'],
    );
    for (const userId of staffUserIds) {
      await this.notifications.publish({
        userId,
        type: NotificationType.APPLICATION_SUBMITTED,
        idempotencyKey: `${NotificationType.APPLICATION_SUBMITTED}:${application.id}:${userId}`,
        organizationId: application.organizationId,
        propertyId: application.propertyId,
        templateVars: {
          applicantName: application.fullName,
          propertyName: application.property.name,
        },
        data: { screen: 'APPLICATION', applicationId: application.id },
      });
    }
  }

  private async onApplicationReviewStarted(
    p: ApplicationEventPayload,
  ): Promise<void> {
    const application = await this.prisma.tenantApplication.findUnique({
      where: { id: p.applicationId },
      include: { property: true },
    });
    if (!application?.applicantUserId) return;
    await this.notifications.publish({
      userId: application.applicantUserId,
      type: NotificationType.APPLICATION_REVIEW_STARTED,
      idempotencyKey: `${NotificationType.APPLICATION_REVIEW_STARTED}:${application.id}`,
      organizationId: application.organizationId,
      propertyId: application.propertyId,
      templateVars: { propertyName: application.property.name },
      data: { screen: 'APPLICATION', applicationId: application.id },
    });
  }

  private async onApplicationApproved(
    p: ApplicationEventPayload,
  ): Promise<void> {
    const application = await this.prisma.tenantApplication.findUnique({
      where: { id: p.applicationId },
      include: { property: true },
    });
    if (!application?.applicantUserId || application.status !== 'APPROVED')
      return;
    await this.notifications.publish({
      userId: application.applicantUserId,
      type: NotificationType.APPLICATION_APPROVED,
      idempotencyKey: `${NotificationType.APPLICATION_APPROVED}:${application.id}`,
      organizationId: application.organizationId,
      propertyId: application.propertyId,
      templateVars: { propertyName: application.property.name },
      data: { screen: 'APPLICATION', applicationId: application.id },
    });
  }

  private async onApplicationRejected(
    p: ApplicationEventPayload,
  ): Promise<void> {
    const application = await this.prisma.tenantApplication.findUnique({
      where: { id: p.applicationId },
      include: { property: true },
    });
    if (!application?.applicantUserId || application.status !== 'REJECTED')
      return;
    await this.notifications.publish({
      userId: application.applicantUserId,
      type: NotificationType.APPLICATION_REJECTED,
      idempotencyKey: `${NotificationType.APPLICATION_REJECTED}:${application.id}`,
      organizationId: application.organizationId,
      propertyId: application.propertyId,
      templateVars: {
        propertyName: application.property.name,
        // Only the public-safe rejectionReason - internalReviewNotes is
        // never read here (spec: never leak it to the applicant).
        reasonSuffix: application.rejectionReason
          ? ` Reason: ${application.rejectionReason}`
          : '',
      },
      data: { screen: 'APPLICATION', applicationId: application.id },
    });
  }

  private async onVisitState(
    p: VisitEventPayload,
    type:
      | typeof NotificationType.VISIT_SCHEDULED
      | typeof NotificationType.VISIT_RESCHEDULED
      | typeof NotificationType.VISIT_CANCELLED,
  ): Promise<void> {
    const visit = await this.prisma.propertyVisit.findUnique({
      where: { id: p.visitId },
      include: { property: true },
    });
    if (!visit?.applicantUserId) return;
    await this.notifications.publish({
      userId: visit.applicantUserId,
      type,
      idempotencyKey: `${type}:${visit.id}:${visit.updatedAt.getTime()}`,
      organizationId: visit.organizationId,
      propertyId: visit.propertyId,
      templateVars: {
        propertyName: visit.property.name,
        scheduledAt: visit.scheduledStartAt
          ? visit.scheduledStartAt.toISOString()
          : '',
      },
      data: { screen: 'VISIT', visitId: visit.id },
    });
  }

  // No-show also notifies the OWNER/MANAGER side (spec), in addition to
  // the applicant.
  private async onVisitNoShow(p: VisitEventPayload): Promise<void> {
    const visit = await this.prisma.propertyVisit.findUnique({
      where: { id: p.visitId },
      include: { property: true },
    });
    if (!visit) return;
    if (visit.applicantUserId) {
      await this.notifications.publish({
        userId: visit.applicantUserId,
        type: NotificationType.VISIT_NO_SHOW,
        idempotencyKey: `${NotificationType.VISIT_NO_SHOW}:${visit.id}:applicant`,
        organizationId: visit.organizationId,
        propertyId: visit.propertyId,
        templateVars: { propertyName: visit.property.name },
        data: { screen: 'VISIT', visitId: visit.id },
      });
    }
    const staffUserIds = await this.recipients.activeOrgMembersByRole(
      visit.organizationId,
      ['OWNER', 'MANAGER'],
    );
    for (const userId of staffUserIds) {
      await this.notifications.publish({
        userId,
        type: NotificationType.VISIT_NO_SHOW,
        idempotencyKey: `${NotificationType.VISIT_NO_SHOW}:${visit.id}:${userId}`,
        organizationId: visit.organizationId,
        propertyId: visit.propertyId,
        templateVars: { propertyName: visit.property.name },
        data: { screen: 'VISIT', visitId: visit.id },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Residency (spec section 35/67)
  // ---------------------------------------------------------------------

  private async onResidencyCheckedIn(p: ResidencyEventPayload): Promise<void> {
    const residency = await this.prisma.residency.findUnique({
      where: { id: p.residencyId },
      include: { tenant: { select: { userId: true } }, property: true },
    });
    if (!residency) return;
    await this.notifications.publish({
      userId: residency.tenant.userId,
      type: NotificationType.RESIDENCY_CHECKED_IN,
      idempotencyKey: `${NotificationType.RESIDENCY_CHECKED_IN}:${residency.id}`,
      organizationId: residency.property.organizationId,
      propertyId: residency.propertyId,
      templateVars: { propertyName: residency.property.name },
      data: { screen: 'RESIDENCY', residencyId: residency.id },
    });
  }

  private async onResidencyCheckedOut(p: ResidencyEventPayload): Promise<void> {
    const residency = await this.prisma.residency.findUnique({
      where: { id: p.residencyId },
      include: { tenant: { select: { userId: true } }, property: true },
    });
    if (!residency) return;
    await this.notifications.publish({
      userId: residency.tenant.userId,
      type: NotificationType.RESIDENCY_CHECKED_OUT,
      // Scoped by actualEndDate so a genuine re-checkout of a later stay
      // at the same property (a returning resident) still notifies -
      // never scoped by residencyId alone plus a fixed string, which
      // would only ever fire once per residency (true here anyway since
      // checkout is terminal, but explicit for clarity).
      idempotencyKey: `${NotificationType.RESIDENCY_CHECKED_OUT}:${residency.id}`,
      organizationId: residency.property.organizationId,
      propertyId: residency.propertyId,
      templateVars: { propertyName: residency.property.name },
      data: { screen: 'RESIDENCY', residencyId: residency.id },
    });
  }

  // ---------------------------------------------------------------------
  // Rent (spec section 36)
  // ---------------------------------------------------------------------

  private async onInvoiceIssued(p: InvoiceEventPayload): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: p.invoiceId },
      include: {
        residency: {
          include: { tenant: { select: { userId: true } }, property: true },
        },
      },
    });
    if (!invoice) return;
    await this.notifications.publish({
      userId: invoice.residency.tenant.userId,
      type: NotificationType.RENT_INVOICE_ISSUED,
      idempotencyKey: `${NotificationType.RENT_INVOICE_ISSUED}:${invoice.id}`,
      organizationId: invoice.residency.property.organizationId,
      propertyId: invoice.residency.propertyId,
      templateVars: {
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.total.toString(),
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
      },
      data: { screen: 'INVOICE', invoiceId: invoice.id },
    });
  }

  private async onInvoiceOverdue(p: InvoiceEventPayload): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: p.invoiceId },
      include: {
        residency: {
          include: { tenant: { select: { userId: true } }, property: true },
        },
      },
    });
    if (!invoice) return;
    await this.notifications.publish({
      userId: invoice.residency.tenant.userId,
      type: NotificationType.RENT_INVOICE_OVERDUE,
      idempotencyKey: `${NotificationType.RENT_INVOICE_OVERDUE}:${invoice.id}`,
      organizationId: invoice.residency.property.organizationId,
      propertyId: invoice.residency.propertyId,
      templateVars: {
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.total.toString(),
      },
      data: { screen: 'INVOICE', invoiceId: invoice.id },
    });
  }

  private async onRentPaymentSuccess(
    p: RentPaymentEventPayload,
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: p.paymentId },
    });
    if (!payment || payment.status !== 'CAPTURED') return;
    await this.notifications.publish({
      userId: payment.payerUserId,
      type: NotificationType.RENT_PAYMENT_SUCCESS,
      idempotencyKey: `${NotificationType.RENT_PAYMENT_SUCCESS}:${payment.id}`,
      organizationId: payment.organizationId,
      propertyId: payment.propertyId,
      templateVars: { amount: payment.amount.toString() },
      data: {
        screen: 'PAYMENT',
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
      },
    });
  }

  private async onRentPaymentFailed(p: RentPaymentEventPayload): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: p.paymentId },
    });
    if (!payment || payment.status !== 'FAILED') return;
    await this.notifications.publish({
      userId: payment.payerUserId,
      type: NotificationType.RENT_PAYMENT_FAILED,
      idempotencyKey: `${NotificationType.RENT_PAYMENT_FAILED}:${payment.id}`,
      organizationId: payment.organizationId,
      propertyId: payment.propertyId,
      templateVars: { amount: payment.amount.toString() },
      data: {
        screen: 'PAYMENT',
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Food (spec section 37-38/67-68)
  // ---------------------------------------------------------------------

  // Broadcasts to every currently-resident tenant at the menu's own
  // property only (spec section 67 - the mandatory cross-property
  // isolation scenario) - never to any other property, even within the
  // same organization.
  private async onFoodMenuChanged(
    p: FoodMenuEventPayload,
    type:
      | typeof NotificationType.FOOD_MENU_PUBLISHED
      | typeof NotificationType.FOOD_MENU_UPDATED,
  ): Promise<void> {
    const menu = await this.prisma.menu.findUnique({
      where: { id: p.menuId },
      include: { property: true },
    });
    if (!menu) return;
    const tenantUserIds = await this.recipients.activeTenantUserIdsForProperty(
      menu.propertyId,
    );
    const dateStr = menu.date.toISOString().slice(0, 10);
    for (const userId of tenantUserIds) {
      await this.notifications.publish({
        userId,
        type,
        // updatedAt discriminates genuinely distinct edits from a
        // retried request for the exact same write (spec section 32) -
        // two different real edits to the same menu produce two
        // notifications; a retried HTTP call for the same edit (same
        // updatedAt) collapses into one.
        idempotencyKey: `${type}:${menu.id}:${menu.updatedAt.getTime()}`,
        organizationId: menu.organizationId,
        propertyId: menu.propertyId,
        templateVars: { date: dateStr, propertyName: menu.property.name },
        data: {
          screen: 'FOOD_MENU',
          propertyId: menu.propertyId,
          date: dateStr,
          menuId: menu.id,
        },
      });
    }
  }

  private async onFoodSubscriptionLifecycle(
    p: FoodSubscriptionEventPayload,
    type:
      | typeof NotificationType.FOOD_SUBSCRIPTION_CREATED
      | typeof NotificationType.FOOD_SUBSCRIPTION_PAUSED
      | typeof NotificationType.FOOD_SUBSCRIPTION_RESUMED
      | typeof NotificationType.FOOD_SUBSCRIPTION_CANCELLED,
  ): Promise<void> {
    const subscription = await this.prisma.tenantFoodSubscription.findUnique({
      where: { id: p.subscriptionId },
      include: { tenant: { select: { userId: true } }, foodPlan: true },
    });
    if (!subscription) return;
    await this.notifications.publish({
      userId: subscription.tenant.userId,
      type,
      idempotencyKey: `${type}:${subscription.id}:${subscription.updatedAt.getTime()}`,
      organizationId: subscription.organizationId,
      propertyId: subscription.propertyId,
      templateVars: { planName: subscription.foodPlan.name },
      data: { screen: 'FOOD_SUBSCRIPTION', subscriptionId: subscription.id },
    });
  }

  private async onFoodSubscriptionPaymentDue(
    p: FoodSubscriptionEventPayload,
  ): Promise<void> {
    const invoice = await this.prisma.foodSubscriptionInvoice.findFirst({
      where: {
        foodSubscriptionId: p.subscriptionId,
        status: { in: ['ISSUED', 'OVERDUE'] },
      },
      orderBy: { createdAt: 'desc' },
      include: { tenant: { select: { userId: true } } },
    });
    if (!invoice) return;
    await this.notifications.publish({
      userId: invoice.tenant.userId,
      type: NotificationType.FOOD_SUBSCRIPTION_PAYMENT_DUE,
      idempotencyKey: `${NotificationType.FOOD_SUBSCRIPTION_PAYMENT_DUE}:${invoice.id}`,
      organizationId: invoice.organizationId,
      propertyId: invoice.propertyId,
      templateVars: { amount: invoice.total.toString() },
      data: { screen: 'FOOD_INVOICE', invoiceId: invoice.id },
    });
  }

  private async onFoodSubscriptionPaymentSuccess(
    p: FoodSubscriptionPaymentEventPayload,
  ): Promise<void> {
    const payment = await this.prisma.foodSubscriptionPayment.findUnique({
      where: { id: p.foodSubscriptionPaymentId },
      include: { tenant: { select: { userId: true } } },
    });
    if (!payment || payment.status !== 'CAPTURED') return;
    await this.notifications.publish({
      userId: payment.tenant.userId,
      type: NotificationType.FOOD_SUBSCRIPTION_PAYMENT_SUCCESS,
      idempotencyKey: `${NotificationType.FOOD_SUBSCRIPTION_PAYMENT_SUCCESS}:${payment.id}`,
      organizationId: payment.organizationId,
      propertyId: payment.propertyId,
      templateVars: { amount: payment.amount.toString() },
      data: {
        screen: 'FOOD_INVOICE',
        invoiceId: payment.foodSubscriptionInvoiceId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Complaints (spec section 39-40/68/79) - INTERNAL comment content is
  // never read or referenced anywhere in this file; every complaint
  // notification below only ever uses `title`/`status`/`category`, which
  // are always public complaint fields, never a comment body.
  // ---------------------------------------------------------------------

  private async onComplaintCreated(p: ComplaintEventPayload): Promise<void> {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id: p.complaintId },
      include: { property: true },
    });
    if (!complaint) return;
    const staffUserIds = await this.recipients.activeOrgMembersByRole(
      complaint.organizationId,
      ['OWNER', 'MANAGER'],
    );
    for (const userId of staffUserIds) {
      await this.notifications.publish({
        userId,
        type: NotificationType.COMPLAINT_CREATED,
        idempotencyKey: `${NotificationType.COMPLAINT_CREATED}:${complaint.id}:${userId}`,
        organizationId: complaint.organizationId,
        propertyId: complaint.propertyId,
        templateVars: {
          category: complaint.category,
          title: complaint.title,
          propertyName: complaint.property.name,
        },
        data: { screen: 'COMPLAINT', complaintId: complaint.id },
      });
    }
  }

  private async onComplaintAssigned(p: ComplaintEventPayload): Promise<void> {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id: p.complaintId },
    });
    if (!complaint || !complaint.assignedToUserId) return;
    await this.notifications.publish({
      userId: complaint.assignedToUserId,
      type: NotificationType.COMPLAINT_ASSIGNED,
      // Includes the assignee so a re-assignment to a different staff
      // member still notifies the new assignee even though the
      // complaintId is unchanged (spec section 43/68).
      idempotencyKey: `${NotificationType.COMPLAINT_ASSIGNED}:${complaint.id}:${complaint.assignedToUserId}`,
      organizationId: complaint.organizationId,
      propertyId: complaint.propertyId,
      templateVars: { title: complaint.title },
      data: { screen: 'COMPLAINT', complaintId: complaint.id },
    });
  }

  private async onComplaintStatusChanged(
    p: ComplaintEventPayload & { newStatus?: string },
  ): Promise<void> {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id: p.complaintId },
      include: { tenant: { select: { userId: true } } },
    });
    if (!complaint) return;
    await this.notifications.publish({
      userId: complaint.tenant.userId,
      type: NotificationType.COMPLAINT_STATUS_CHANGED,
      idempotencyKey: `${NotificationType.COMPLAINT_STATUS_CHANGED}:${complaint.id}:${complaint.status}`,
      organizationId: complaint.organizationId,
      propertyId: complaint.propertyId,
      templateVars: { title: complaint.title, status: complaint.status },
      data: { screen: 'COMPLAINT', complaintId: complaint.id },
    });
  }

  private async onComplaintTerminal(
    p: ComplaintEventPayload,
    type:
      | typeof NotificationType.COMPLAINT_RESOLVED
      | typeof NotificationType.COMPLAINT_CLOSED,
  ): Promise<void> {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id: p.complaintId },
      include: { tenant: { select: { userId: true } } },
    });
    if (!complaint) return;
    await this.notifications.publish({
      userId: complaint.tenant.userId,
      type,
      idempotencyKey: `${type}:${complaint.id}`,
      organizationId: complaint.organizationId,
      propertyId: complaint.propertyId,
      templateVars: { title: complaint.title },
      data: { screen: 'COMPLAINT', complaintId: complaint.id },
    });
  }

  // ---------------------------------------------------------------------
  // SaaS subscription (spec section 41/71) - OWNER/MANAGER only, never a
  // tenant, since this is entirely about the organization's own platform
  // billing.
  // ---------------------------------------------------------------------

  private async onSaasSubscriptionState(
    p: SaasSubscriptionEventPayload,
    type:
      | typeof NotificationType.SAAS_SUBSCRIPTION_RENEWAL_DUE
      | typeof NotificationType.SAAS_SUBSCRIPTION_SUSPENDED,
  ): Promise<void> {
    const ownerUserIds = await this.recipients.activeOrgMembersByRole(
      p.organizationId,
      ['OWNER'],
    );
    const now = Date.now();
    for (const userId of ownerUserIds) {
      await this.notifications.publish({
        userId,
        type,
        // Bucketed to the hour so re-evaluating the same still-due/
        // still-suspended state on every subsequent read never spams a
        // fresh notification (evaluateLifecycle is called on every
        // incidental read - see SubscriptionsService), while a genuinely
        // new occurrence hours later still notifies again.
        idempotencyKey: `${type}:${p.organizationId}:${userId}:${Math.floor(now / 3_600_000)}`,
        organizationId: p.organizationId,
        templateVars: { dueDate: new Date(now).toISOString().slice(0, 10) },
        data: { screen: 'SAAS_SUBSCRIPTION', organizationId: p.organizationId },
      });
    }
  }

  private async onSaasSubscriptionPayment(
    p: SaasSubscriptionPaymentEventPayload,
    type:
      | typeof NotificationType.SAAS_SUBSCRIPTION_PAYMENT_SUCCESS
      | typeof NotificationType.SAAS_SUBSCRIPTION_PAYMENT_FAILED,
  ): Promise<void> {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: p.subscriptionPaymentId },
    });
    if (!payment) return;
    const ownerUserIds = await this.recipients.activeOrgMembersByRole(
      payment.organizationId,
      ['OWNER'],
    );
    for (const userId of ownerUserIds) {
      await this.notifications.publish({
        userId,
        type,
        idempotencyKey: `${type}:${payment.id}:${userId}`,
        organizationId: payment.organizationId,
        templateVars: { amount: payment.amount.toString() },
        data: {
          screen: 'SAAS_SUBSCRIPTION',
          organizationId: payment.organizationId,
        },
      });
    }
  }
}
