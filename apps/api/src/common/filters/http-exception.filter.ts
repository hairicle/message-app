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

/**
 * Prisma's codes for a supplied value that cannot be read as the column's type — most often a path
 * or query parameter that is not a UUID.
 *
 * Both, because which one is raised depends on how the query reaches the database: the driver
 * adapter this app uses reports P2007 where the older engine reported P2023, and a filter that
 * knew only one of them would keep answering 500 for the other. Recognised by shape rather than
 * instanceof for the same reason as the Zod error below — @prisma/client can resolve to more than
 * one copy, and an instanceof against the wrong one fails silently.
 */
const PRISMA_BAD_INPUT_CODES = new Set(['P2007', 'P2023']);

interface PrismaLikeError {
  name: string;
  code: string;
}

function isMalformedIdError(error: unknown): error is PrismaLikeError {
  return (
    typeof error === 'object'
    && error !== null
    && PRISMA_BAD_INPUT_CODES.has((error as PrismaLikeError).code)
    && String((error as PrismaLikeError).name).startsWith('PrismaClient')
  );
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

    // An identifier that is not a UUID reaches Postgres, which rejects it — and that came back as
    // 500 "Internal server error". A mistyped id in a URL is the caller's mistake, and every one
    // was logged as a server fault, which is how real faults get lost. The message deliberately
    // does not repeat the value: it arrived in the URL and echoing it back into a response is how
    // reflected content ends up somewhere it should not be.
    if (isMalformedIdError(exception)) {
      response.status(HttpStatus.BAD_REQUEST).json({ error: 'That identifier is not valid' });
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
