import { registerAs } from '@nestjs/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Fails the boot when something the API cannot run without is missing.
 *
 * This namespace used to carry thirty settings and **nothing read any of them** — every consumer
 * reaches for its own variable directly, through `ConfigService.get('STORAGE_ENDPOINT')` or
 * `process.env`. The list had become a second, silent source of truth: it named LDAP, Firebase and
 * MinIO settings for features that do not exist, and defaults like `frontendUrl` that no code path
 * could ever apply. Anyone reading it would reasonably conclude those settings did something.
 *
 * What it does do is throw at startup, by name, when one of these three is absent — which is worth
 * far more than the list was, and is why the module is still registered.
 */
export default registerAs('app', () => ({
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  jwtSecret: required('JWT_SECRET'),
}));
