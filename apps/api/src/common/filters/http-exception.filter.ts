import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/** The parts of a ZodError this needs, without depending on which copy of zod threw it. */
interface ZodLikeError {
  name: string;
  issues: { path: (string | number)[]; message: string }[];
}

function isZodError(error: unknown): error is ZodLikeError {
  return (
    typeof error === 'object'
    && error !== null
    && (error as ZodLikeError).name === 'ZodError'
    && Array.isArray((error as ZodLikeError).issues)
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // A controller validating its body with a Zod schema throws a ZodError, which is not an
    // HttpException — so it fell to the branch below and came back as 500 "Internal server
    // error". A malformed request is the caller's to fix, and telling them it was ours meant
    // they could not, while every one of them was logged as a server fault and buried the real
    // ones. `zod` can resolve to more than one copy in a workspace, so this recognises the shape
    // rather than relying on instanceof.
    if (isZodError(exception)) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: 'Invalid request',
        // Named so the caller knows which field, since "invalid request" alone is barely better
        // than the 500 it replaces.
        fields: exception.issues.map((issue) => ({
          field: issue.path.join('.') || '(body)',
          message: issue.message,
        })),
      });
      return;
    }

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
