-- CreateEnum
CREATE TYPE "ResidencyStatus" AS ENUM ('PENDING', 'ACTIVE', 'NOTICE_PERIOD', 'CHECKED_OUT');

-- DropForeignKey
ALTER TABLE "bed_allocations" DROP CONSTRAINT "bed_allocations_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_userId_fkey";

-- DropIndex
DROP INDEX "bed_allocations_tenantId_idx";

-- DropIndex
DROP INDEX "tenants_organizationId_idx";

-- AlterTable
ALTER TABLE "bed_allocations" DROP COLUMN "tenantId",
ADD COLUMN     "residencyId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "email",
DROP COLUMN "name",
DROP COLUMN "organizationId",
DROP COLUMN "phone",
DROP COLUMN "status",
ALTER COLUMN "userId" SET NOT NULL;

-- DropEnum
DROP TYPE "TenantStatus";

-- CreateTable
CREATE TABLE "residencies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "expectedEndDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "status" "ResidencyStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "residencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "residencies_tenantId_idx" ON "residencies"("tenantId");

-- CreateIndex
CREATE INDEX "residencies_propertyId_idx" ON "residencies"("propertyId");

-- CreateIndex
CREATE INDEX "residencies_propertyId_status_idx" ON "residencies"("propertyId", "status");

-- CreateIndex
CREATE INDEX "bed_allocations_residencyId_idx" ON "bed_allocations"("residencyId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residencies" ADD CONSTRAINT "residencies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residencies" ADD CONSTRAINT "residencies_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_allocations" ADD CONSTRAINT "bed_allocations_residencyId_fkey" FOREIGN KEY ("residencyId") REFERENCES "residencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial unique indexes (Prisma's schema DSL cannot express a WHERE
-- clause on a unique index - see Residency/BedAllocation doc comments in
-- schema.prisma for the invariants these enforce).

-- At most one ACTIVE residency per tenant - the database-level backstop
-- for "a tenant should not be resident at two properties simultaneously".
CREATE UNIQUE INDEX "residencies_active_tenant_unique"
  ON "residencies" ("tenantId")
  WHERE "status" = 'ACTIVE';

-- At most one ACTIVE allocation per bed - the database-level backstop for
-- "a bed cannot have two overlapping active allocations", immune to
-- concurrent check-in requests for the same bed.
CREATE UNIQUE INDEX "bed_allocations_active_bed_unique"
  ON "bed_allocations" ("bedId")
  WHERE "status" = 'ACTIVE';
