-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'OTHER');

-- CreateEnum
CREATE TYPE "FoodPlanStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FoodSubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MenuStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MealConsumptionSource" AS ENUM ('STAFF_MARKED', 'TENANT_MARKED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FoodSubscriptionInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'OVERDUE', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "FoodSubscriptionPaymentStatus" AS ENUM ('CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "food_configurations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mealsIncludedInRent" BOOLEAN NOT NULL DEFAULT false,
    "includedMealTypes" "MealType"[] DEFAULT ARRAY[]::"MealType"[],
    "optionalSubscriptionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FoodPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "mealTypes" "MealType"[] DEFAULT ARRAY[]::"MealType"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_food_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "residencyId" TEXT NOT NULL,
    "foodPlanId" TEXT NOT NULL,
    "status" "FoodSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "priceSnapshot" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "mealTypesSnapshot" "MealType"[] DEFAULT ARRAY[]::"MealType"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_food_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_subscription_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "residencyId" TEXT NOT NULL,
    "foodSubscriptionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "FoodSubscriptionInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_subscription_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "residencyId" TEXT NOT NULL,
    "foodSubscriptionId" TEXT NOT NULL,
    "foodSubscriptionInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "status" "FoodSubscriptionPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "idempotencyKey" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "MenuStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isVegetarian" BOOLEAN NOT NULL DEFAULT true,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_consumptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "residencyId" TEXT NOT NULL,
    "menuId" TEXT,
    "menuItemId" TEXT,
    "mealType" "MealType" NOT NULL,
    "mealDate" DATE NOT NULL,
    "itemNamesSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "MealConsumptionSource" NOT NULL DEFAULT 'STAFF_MARKED',
    "markedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "food_configurations_propertyId_key" ON "food_configurations"("propertyId");

-- CreateIndex
CREATE INDEX "food_configurations_organizationId_idx" ON "food_configurations"("organizationId");

-- CreateIndex
CREATE INDEX "food_plans_organizationId_idx" ON "food_plans"("organizationId");

-- CreateIndex
CREATE INDEX "food_plans_propertyId_status_idx" ON "food_plans"("propertyId", "status");

-- CreateIndex
CREATE INDEX "tenant_food_subscriptions_organizationId_idx" ON "tenant_food_subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "tenant_food_subscriptions_propertyId_idx" ON "tenant_food_subscriptions"("propertyId");

-- CreateIndex
CREATE INDEX "tenant_food_subscriptions_tenantId_createdAt_idx" ON "tenant_food_subscriptions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_food_subscriptions_residencyId_status_idx" ON "tenant_food_subscriptions"("residencyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "food_subscription_invoices_invoiceNumber_key" ON "food_subscription_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "food_subscription_invoices_organizationId_status_idx" ON "food_subscription_invoices"("organizationId", "status");

-- CreateIndex
CREATE INDEX "food_subscription_invoices_tenantId_createdAt_idx" ON "food_subscription_invoices"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "food_subscription_invoices_dueAt_status_idx" ON "food_subscription_invoices"("dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "food_subscription_invoices_period_unique" ON "food_subscription_invoices"("foodSubscriptionId", "billingPeriodStart", "billingPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "food_subscription_payments_providerOrderId_key" ON "food_subscription_payments"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "food_subscription_payments_providerPaymentId_key" ON "food_subscription_payments"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "food_subscription_payments_idempotencyKey_key" ON "food_subscription_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "food_subscription_payments_organizationId_idx" ON "food_subscription_payments"("organizationId");

-- CreateIndex
CREATE INDEX "food_subscription_payments_tenantId_idx" ON "food_subscription_payments"("tenantId");

-- CreateIndex
CREATE INDEX "food_subscription_payments_foodSubscriptionInvoiceId_idx" ON "food_subscription_payments"("foodSubscriptionInvoiceId");

-- CreateIndex
CREATE INDEX "menus_organizationId_idx" ON "menus"("organizationId");

-- CreateIndex
CREATE INDEX "menus_propertyId_status_idx" ON "menus"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "menus_propertyId_date_key" ON "menus"("propertyId", "date");

-- CreateIndex
CREATE INDEX "menu_items_menuId_idx" ON "menu_items"("menuId");

-- CreateIndex
CREATE INDEX "menu_items_menuId_mealType_idx" ON "menu_items"("menuId", "mealType");

-- CreateIndex
CREATE INDEX "meal_consumptions_organizationId_idx" ON "meal_consumptions"("organizationId");

-- CreateIndex
CREATE INDEX "meal_consumptions_propertyId_idx" ON "meal_consumptions"("propertyId");

-- CreateIndex
CREATE INDEX "meal_consumptions_tenantId_mealDate_idx" ON "meal_consumptions"("tenantId", "mealDate");

-- CreateIndex
CREATE INDEX "meal_consumptions_menuId_idx" ON "meal_consumptions"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_consumptions_residencyId_mealDate_mealType_key" ON "meal_consumptions"("residencyId", "mealDate", "mealType");

-- AddForeignKey
ALTER TABLE "food_configurations" ADD CONSTRAINT "food_configurations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_configurations" ADD CONSTRAINT "food_configurations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_plans" ADD CONSTRAINT "food_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_plans" ADD CONSTRAINT "food_plans_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_food_subscriptions" ADD CONSTRAINT "tenant_food_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_food_subscriptions" ADD CONSTRAINT "tenant_food_subscriptions_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_food_subscriptions" ADD CONSTRAINT "tenant_food_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_food_subscriptions" ADD CONSTRAINT "tenant_food_subscriptions_residencyId_fkey" FOREIGN KEY ("residencyId") REFERENCES "residencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_food_subscriptions" ADD CONSTRAINT "tenant_food_subscriptions_foodPlanId_fkey" FOREIGN KEY ("foodPlanId") REFERENCES "food_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_invoices" ADD CONSTRAINT "food_subscription_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_invoices" ADD CONSTRAINT "food_subscription_invoices_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_invoices" ADD CONSTRAINT "food_subscription_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_invoices" ADD CONSTRAINT "food_subscription_invoices_residencyId_fkey" FOREIGN KEY ("residencyId") REFERENCES "residencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_invoices" ADD CONSTRAINT "food_subscription_invoices_foodSubscriptionId_fkey" FOREIGN KEY ("foodSubscriptionId") REFERENCES "tenant_food_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_payments" ADD CONSTRAINT "food_subscription_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_payments" ADD CONSTRAINT "food_subscription_payments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_payments" ADD CONSTRAINT "food_subscription_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_payments" ADD CONSTRAINT "food_subscription_payments_residencyId_fkey" FOREIGN KEY ("residencyId") REFERENCES "residencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_payments" ADD CONSTRAINT "food_subscription_payments_foodSubscriptionId_fkey" FOREIGN KEY ("foodSubscriptionId") REFERENCES "tenant_food_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_subscription_payments" ADD CONSTRAINT "food_subscription_payments_foodSubscriptionInvoiceId_fkey" FOREIGN KEY ("foodSubscriptionInvoiceId") REFERENCES "food_subscription_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_consumptions" ADD CONSTRAINT "meal_consumptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_consumptions" ADD CONSTRAINT "meal_consumptions_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_consumptions" ADD CONSTRAINT "meal_consumptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_consumptions" ADD CONSTRAINT "meal_consumptions_residencyId_fkey" FOREIGN KEY ("residencyId") REFERENCES "residencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_consumptions" ADD CONSTRAINT "meal_consumptions_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "menus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_consumptions" ADD CONSTRAINT "meal_consumptions_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_consumptions" ADD CONSTRAINT "meal_consumptions_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written addition (Prisma's schema DSL cannot express a partial
-- unique index): at most one ACTIVE food subscription per residency,
-- mirroring bed_allocations_active_bed_unique / rent_plans_active_residency_unique.
CREATE UNIQUE INDEX "food_subscriptions_active_residency_unique"
  ON "tenant_food_subscriptions" ("residencyId")
  WHERE "status" = 'ACTIVE';

-- Hand-written addition: concurrency-safe food invoice numbering, the
-- same pattern as invoice_number_seq (Phase 5) / saas_invoice_number_seq
-- (Phase 7) - never COUNT(*) + 1, which races under concurrent generation.
CREATE SEQUENCE IF NOT EXISTS "food_invoice_number_seq" START 1;
