import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { appConfig, jwtConfig, razorpayConfig } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { IdentityVerificationModule } from './modules/identity-verification/identity-verification.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { BedsModule } from './modules/beds/beds.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ResidenciesModule } from './modules/residencies/residencies.module';
import { RentPlansModule } from './modules/rent-plans/rent-plans.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ErrorCode } from './common/constants/error-code.enum';
import { AppException } from './common/exceptions/app.exception';
import { HttpStatus } from '@nestjs/common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      load: [appConfig, jwtConfig, razorpayConfig],
    }),
    ThrottlerModule.forRoot([
      {
        // Conservative default so a single client cannot exhaust a small
        // instance. Per-route overrides can be added with @Throttle() once
        // real traffic patterns (e.g. OTP request endpoints) demand it.
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
    IdentityVerificationModule,
    MembershipsModule,
    OrganizationsModule,
    PropertiesModule,
    RoomsModule,
    BedsModule,
    TenantsModule,
    ResidenciesModule,
    RentPlansModule,
    InvoicesModule,
    PaymentsModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
          exceptionFactory: (validationErrors) =>
            new AppException(
              ErrorCode.VALIDATION_FAILED,
              'Validation failed',
              HttpStatus.BAD_REQUEST,
              validationErrors.map((error) => ({
                field: error.property,
                constraints: error.constraints,
              })),
            ),
        }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
