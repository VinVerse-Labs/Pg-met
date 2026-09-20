-- CreateEnum
CREATE TYPE "SaasPlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SaasBillingInterval" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'RENEWAL_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'OVERDUE', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "saas_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "billingInterval" "SaasBillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "status" "SaasPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saas_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saasPlanId" TEXT NOT NULL,
    "pendingSaasPlanId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "nextBillingAt" TIMESTAMP(3) NOT NULL,
    "gracePeriodEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "saasPlanId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "subscriptionInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "idempotencyKey" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saas_plans_status_idx" ON "saas_plans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_subscriptions_organizationId_key" ON "organization_subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "organization_subscriptions_status_idx" ON "organization_subscriptions"("status");

-- CreateIndex
CREATE INDEX "organization_subscriptions_nextBillingAt_idx" ON "organization_subscriptions"("nextBillingAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_invoiceNumber_key" ON "subscription_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "subscription_invoices_organizationId_status_idx" ON "subscription_invoices"("organizationId", "status");

-- CreateIndex
CREATE INDEX "subscription_invoices_dueAt_status_idx" ON "subscription_invoices"("dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_period_unique" ON "subscription_invoices"("subscriptionId", "billingPeriodStart", "billingPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_providerOrderId_key" ON "subscription_payments"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_providerPaymentId_key" ON "subscription_payments"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_idempotencyKey_key" ON "subscription_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "subscription_payments_organizationId_idx" ON "subscription_payments"("organizationId");

-- CreateIndex
CREATE INDEX "subscription_payments_subscriptionId_idx" ON "subscription_payments"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_payments_subscriptionInvoiceId_idx" ON "subscription_payments"("subscriptionInvoiceId");

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_saasPlanId_fkey" FOREIGN KEY ("saasPlanId") REFERENCES "saas_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_pendingSaasPlanId_fkey" FOREIGN KEY ("pendingSaasPlanId") REFERENCES "saas_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_saasPlanId_fkey" FOREIGN KEY ("saasPlanId") REFERENCES "saas_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "organization_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscriptionInvoiceId_fkey" FOREIGN KEY ("subscriptionInvoiceId") REFERENCES "subscription_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Concurrency-safe SaaS invoice numbering (never COUNT(*) + 1), same
-- pattern as Phase 5's invoice_number_seq.
CREATE SEQUENCE IF NOT EXISTS saas_invoice_number_seq START 1;

-- Seed a default active plan so the platform is usable immediately after
-- this migration - SubscriptionsService.getOrCreateForOrganization picks
-- the oldest ACTIVE plan as the default. Price is easy to change later by
-- inserting a new plan row and marking this one INACTIVE (see SaasPlan's
-- doc comment) - it is never hardcoded in application code.
INSERT INTO "saas_plans" ("id", "name", "description", "price", "currency", "billingInterval", "status", "effectiveFrom", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'Basic', 'Default PG management plan', 499.00, 'INR', 'MONTHLY', 'ACTIVE', now(), now(), now());
