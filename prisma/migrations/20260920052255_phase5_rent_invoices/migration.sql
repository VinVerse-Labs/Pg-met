-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "RentPlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceItemType" AS ENUM ('RENT');

-- CreateTable
CREATE TABLE "rent_plans" (
    "id" TEXT NOT NULL,
    "residencyId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "dueDay" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "RentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "residencyId" TEXT NOT NULL,
    "rentPlanId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "itemType" "InvoiceItemType" NOT NULL DEFAULT 'RENT',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rent_plans_residencyId_idx" ON "rent_plans"("residencyId");

-- CreateIndex
CREATE INDEX "rent_plans_residencyId_status_idx" ON "rent_plans"("residencyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_residencyId_status_idx" ON "invoices"("residencyId", "status");

-- CreateIndex
CREATE INDEX "invoices_dueDate_status_idx" ON "invoices"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_residencyId_billingPeriodStart_billingPeriodEnd_key" ON "invoices"("residencyId", "billingPeriodStart", "billingPeriodEnd");

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- AddForeignKey
ALTER TABLE "rent_plans" ADD CONSTRAINT "rent_plans_residencyId_fkey" FOREIGN KEY ("residencyId") REFERENCES "residencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_residencyId_fkey" FOREIGN KEY ("residencyId") REFERENCES "residencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rentPlanId_fkey" FOREIGN KEY ("rentPlanId") REFERENCES "rent_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Concurrency-safe invoice number generation (spec section 12: must never
-- use COUNT(*) + 1, which races under concurrent generation). A Postgres
-- sequence's nextval() is atomic and non-blocking even across concurrent
-- transactions - exactly the guarantee needed here. See
-- InvoicesService.generateInvoiceNumber for how this is called
-- (`SELECT nextval('invoice_number_seq')`) and formatted
-- (e.g. "INV-2027-000001"). A rolled-back transaction "loses" a sequence
-- value (gaps are possible) - acceptable and standard: the only actual
-- requirement is uniqueness, not gaplessness.
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
