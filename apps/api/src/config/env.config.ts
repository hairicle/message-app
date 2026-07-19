import { registerAs } from '@nestjs/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export default registerAs('app', () => ({
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  uploadsDir: process.env.UPLOADS_DIR ?? 'uploads',
  maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_MB ?? 25) * 1024 * 1024,
  minioEndpoint: process.env.STORAGE_ENDPOINT ?? process.env.MINIO_ENDPOINT,
  minioAccessKey: process.env.STORAGE_ACCESS_KEY ?? process.env.MINIO_ACCESS_KEY,
  minioSecretKey: process.env.STORAGE_SECRET_KEY ?? process.env.MINIO_SECRET_KEY,
  minioBucket: process.env.STORAGE_BUCKET ?? process.env.MINIO_BUCKET ?? 'messenger-files',
  minioRegion: process.env.STORAGE_REGION ?? process.env.MINIO_REGION ?? 'us-east-1',
  avatarBucket: process.env.AVATAR_BUCKET ?? 'avatars',
  ldapUrl: process.env.LDAP_URL,
  ldapBaseDn: process.env.LDAP_BASE_DN ?? '',
  ldapBindDn: process.env.LDAP_BIND_DN,
  ldapBindPassword: process.env.LDAP_BIND_PASSWORD,
  ldapUsernameAttr: process.env.LDAP_USERNAME_ATTR ?? 'uid',
  totpIssuer: process.env.TOTP_ISSUER ?? 'InternalMessenger',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
}));
