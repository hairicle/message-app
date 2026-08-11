import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { allowedOrigins } from './common/cors';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AvatarUrlInterceptor } from './common/avatar-url.interceptor';
import { AvatarUrlService } from './common/avatar-url.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('bootstrap');

  // One hop, because exactly one reverse proxy sits in front of this in every deployment. Without
  // it Express reports the proxy's address as the client's, so the rate limiter counts the whole
  // internet into a single bucket and the first busy minute locks everybody out together. With a
  // count rather than `true`, Express reads the address the proxy observed instead of the head of
  // the forwarded chain, which the caller writes and can therefore forge.
  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS_ORIGIN has been set in render.yaml and named in the deployment walkthrough since staging
  // was built, and until now nothing read it: this call took no arguments, which reflects whatever
  // Origin a request carries. A live test confirmed the API answered evil.example.com with a
  // wildcard and approved its preflight.
  const origins = allowedOrigins(process.env.CORS_ORIGIN);
  if (!process.env.CORS_ORIGIN) {
    logger.warn(
      `CORS_ORIGIN is not set — allowing only ${origins.join(', ')}. Set it to the web app's origin.`,
    );
  }
  app.enableCors({ origin: origins, credentials: true });

  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  // Resolved from the container so it gets the shared signing cache.
  app.useGlobalInterceptors(new AvatarUrlInterceptor(app.get(AvatarUrlService)));

  const port = process.env.PORT ?? 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on 0.0.0.0:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
