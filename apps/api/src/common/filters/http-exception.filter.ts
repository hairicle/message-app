import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : (body as Record<string, unknown>).message ?? 'An error occurred';
      response.status(status).json({ error: message });
    } else {
      this.logger.error('Unhandled exception', exception);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
    }
  }
}
