import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AvatarUrlInterceptor } from './common/avatar-url.interceptor';
import { AvatarUrlService } from './common/avatar-url.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors();
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
