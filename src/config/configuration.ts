import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10),
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET,
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
}));

export const razorpayConfig = registerAs('razorpay', () => ({
  keyId: process.env.RAZORPAY_KEY_ID,
  keySecret: process.env.RAZORPAY_KEY_SECRET,
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
}));

export const subscriptionConfig = registerAs('subscription', () => ({
  trialDays: parseInt(process.env.DEFAULT_TRIAL_DAYS ?? '30', 10),
  gracePeriodDays: parseInt(
    process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS ?? '7',
    10,
  ),
}));

export const platformAdminConfig = registerAs('platformAdmin', () => ({
  superAdminEmail: process.env.SUPER_ADMIN_EMAIL || null,
}));

export type AppConfig = ReturnType<typeof appConfig>;
export type JwtConfig = ReturnType<typeof jwtConfig>;
export type RazorpayConfig = ReturnType<typeof razorpayConfig>;
export type SubscriptionConfig = ReturnType<typeof subscriptionConfig>;
export type PlatformAdminConfig = ReturnType<typeof platformAdminConfig>;
