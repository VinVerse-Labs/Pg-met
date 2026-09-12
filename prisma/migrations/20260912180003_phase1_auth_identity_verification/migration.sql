-- CreateEnum
CREATE TYPE "IdentityVerificationType" AS ENUM ('GOVERNMENT_ID', 'ADDRESS_VERIFICATION', 'AGE_VERIFICATION');

-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationType" "IdentityVerificationType" NOT NULL,
    "provider" TEXT,
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "providerReference" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_verifications_userId_idx" ON "identity_verifications"("userId");

-- CreateIndex
CREATE INDEX "identity_verifications_userId_verificationType_idx" ON "identity_verifications"("userId", "verificationType");

-- AddForeignKey
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
