import * as Joi from 'joi';

// Fails fast at startup if required configuration is missing or malformed,
// rather than letting the app boot into a half-configured, hard-to-debug
// state (e.g. a missing JWT secret only surfacing on the first login call).
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string().uri().required(),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  CORS_ORIGINS: Joi.string().allow('').default(''),

  // Razorpay (Phase 6). Not required outside of endpoints that actually
  // call the gateway, but validated up front like every other secret in
  // this project - a missing key should fail at startup, not on the first
  // tenant's payment attempt.
  RAZORPAY_KEY_ID: Joi.string().required(),
  RAZORPAY_KEY_SECRET: Joi.string().required(),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().required(),

  // Owner SaaS subscription (Phase 7). Both are business rules that will
  // change over time - never hardcoded as a literal `30`/`7` anywhere in
  // application code (see SubscriptionsService).
  DEFAULT_TRIAL_DAYS: Joi.number().integer().min(0).default(30),
  SUBSCRIPTION_GRACE_PERIOD_DAYS: Joi.number().integer().min(0).default(7),
});
