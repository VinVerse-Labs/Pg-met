-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "Amenity" AS ENUM ('WIFI', 'LAUNDRY', 'PARKING', 'AC', 'POWER_BACKUP', 'HOUSEKEEPING', 'SECURITY', 'CCTV', 'FOOD', 'GYM', 'COMMON_AREA');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'VISIT_SCHEDULED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "property_listings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "description" TEXT,
    "city" TEXT,
    "locality" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "coverImageUrl" TEXT,
    "contactEnabled" BOOLEAN NOT NULL DEFAULT true,
    "startingFromPrice" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "property_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_listing_amenities" (
    "id" TEXT NOT NULL,
    "propertyListingId" TEXT NOT NULL,
    "amenity" "Amenity" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_listing_amenities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_applications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "propertyListingId" TEXT,
    "applicantUserId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "preferredMoveInDate" TIMESTAMP(3),
    "preferredRoomType" "RoomType",
    "preferredStayDuration" INTEGER,
    "notes" TEXT,
    "rejectionReason" TEXT,
    "internalReviewNotes" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "onboardingStartedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_activities" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_visits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "applicantUserId" TEXT,
    "scheduledStartAt" TIMESTAMP(3),
    "scheduledEndAt" TIMESTAMP(3),
    "status" "VisitStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "cancelReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_listings_propertyId_key" ON "property_listings"("propertyId");

-- CreateIndex
CREATE INDEX "property_listings_organizationId_idx" ON "property_listings"("organizationId");

-- CreateIndex
CREATE INDEX "property_listings_status_idx" ON "property_listings"("status");

-- CreateIndex
CREATE INDEX "property_listings_city_idx" ON "property_listings"("city");

-- CreateIndex
CREATE INDEX "property_listings_locality_idx" ON "property_listings"("locality");

-- CreateIndex
CREATE INDEX "property_listing_amenities_propertyListingId_idx" ON "property_listing_amenities"("propertyListingId");

-- CreateIndex
CREATE UNIQUE INDEX "property_listing_amenities_propertyListingId_amenity_key" ON "property_listing_amenities"("propertyListingId", "amenity");

-- CreateIndex
CREATE INDEX "tenant_applications_organizationId_idx" ON "tenant_applications"("organizationId");

-- CreateIndex
CREATE INDEX "tenant_applications_propertyId_idx" ON "tenant_applications"("propertyId");

-- CreateIndex
CREATE INDEX "tenant_applications_applicantUserId_idx" ON "tenant_applications"("applicantUserId");

-- CreateIndex
CREATE INDEX "tenant_applications_status_idx" ON "tenant_applications"("status");

-- CreateIndex
CREATE INDEX "tenant_applications_createdAt_idx" ON "tenant_applications"("createdAt");

-- CreateIndex
CREATE INDEX "tenant_applications_preferredMoveInDate_idx" ON "tenant_applications"("preferredMoveInDate");

-- CreateIndex
CREATE INDEX "application_activities_applicationId_idx" ON "application_activities"("applicationId");

-- CreateIndex
CREATE INDEX "property_visits_organizationId_idx" ON "property_visits"("organizationId");

-- CreateIndex
CREATE INDEX "property_visits_propertyId_idx" ON "property_visits"("propertyId");

-- CreateIndex
CREATE INDEX "property_visits_applicationId_idx" ON "property_visits"("applicationId");

-- CreateIndex
CREATE INDEX "property_visits_scheduledStartAt_idx" ON "property_visits"("scheduledStartAt");

-- CreateIndex
CREATE INDEX "property_visits_status_idx" ON "property_visits"("status");

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listing_amenities" ADD CONSTRAINT "property_listing_amenities_propertyListingId_fkey" FOREIGN KEY ("propertyListingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_propertyListingId_fkey" FOREIGN KEY ("propertyListingId") REFERENCES "property_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_activities" ADD CONSTRAINT "application_activities_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "tenant_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_activities" ADD CONSTRAINT "application_activities_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_visits" ADD CONSTRAINT "property_visits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_visits" ADD CONSTRAINT "property_visits_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_visits" ADD CONSTRAINT "property_visits_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "tenant_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_visits" ADD CONSTRAINT "property_visits_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_visits" ADD CONSTRAINT "property_visits_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma's schema DSL cannot express a partial (WHERE-conditioned) unique
-- index - the same limitation already documented for
-- residencies_active_tenant_unique / bed_allocations_active_bed_unique.
-- This is the database-level backstop for "at most one ACTIVE application
-- per (property, applicant)" - identity keyed by applicantUserId when the
-- applicant is authenticated, else by their normalized phone number, so a
-- guest applicant is covered too. The application layer also pre-checks
-- this at submission time, but this index is what actually guarantees it
-- under a genuine concurrent duplicate-submission race (see
-- TenantApplicationsService.create).
CREATE UNIQUE INDEX "tenant_applications_active_applicant_property_unique"
  ON "tenant_applications" ("propertyId", COALESCE("applicantUserId"::text, "phone"))
  WHERE "status" NOT IN ('REJECTED', 'WITHDRAWN', 'EXPIRED');
