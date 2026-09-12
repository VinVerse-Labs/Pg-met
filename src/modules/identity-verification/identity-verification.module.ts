import { Module } from '@nestjs/common';
import { IdentityVerificationService } from './identity-verification.service';

@Module({
  providers: [IdentityVerificationService],
  exports: [IdentityVerificationService],
})
export class IdentityVerificationModule {}
