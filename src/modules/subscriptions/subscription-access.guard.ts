import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionsService } from './subscriptions.service';

// A reusable, centralized subscription-access policy (spec: "implement
// the subscription-access decision in a reusable service/guard/policy
// rather than scattering status checks throughout controllers") - reads
// `:organizationId` off the route and blocks the request with
// `403 SUBSCRIPTION_SUSPENDED` when that organization's subscription is
// SUSPENDED. Never blocks authentication itself (an owner must still be
// able to log in and pay - spec) - this guard only ever runs *after*
// JwtAuthGuard on a route that already has an `organizationId` param.
//
// **Not currently applied to any Phase 0-6 controller.** Wiring "normal
// management operations are blocked while suspended" into every existing
// properties/rooms/beds/tenants/residencies/rent-plans/invoices/payments
// route would mean touching every one of those stable modules - out of
// scope for Phase 7 per the explicit instruction not to modify previous
// phases' behavior unnecessarily. This guard is the seam that work would
// use; see README's "Phase 7" section and the final report's "known
// limitations" for this deliberate, flagged gap rather than a silent
// guess in either direction.
@Injectable()
export class SubscriptionAccessGuard implements CanActivate {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const organizationId = String(request.params.organizationId);
    const user = request.user as AuthenticatedUser;

    const blocked = await this.subscriptionsService.isAccessBlocked(
      user,
      organizationId,
    );
    if (blocked) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_SUSPENDED,
        'This organization’s subscription is suspended. Pay the outstanding subscription invoice to restore access.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
