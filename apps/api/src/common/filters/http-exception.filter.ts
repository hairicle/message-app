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

/**
 * Multer aborts the request stream the moment an upload passes its limit, and reports it by
 * throwing rather than by returning. The thrown value is not an HttpException, so without this it
 * became a 500 — telling the caller their too-large file was our fault, and burying a routine
 * refusal among real server faults.
 */
interface MulterLikeError {
  name: string;
  code: string;
}

/** What body-parser raises when the request body passes its size ceiling. */
function isPayloadTooLargeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { type?: string; status?: number; statusCode?: number };
  return e.type === 'entity.too.large' || e.status === 413 || e.statusCode === 413;
}

function isUploadLimitError(error: unknown): error is MulterLikeError {
  return (
    typeof error === 'object'
    && error !== null
    && (error as MulterLikeError).name === 'MulterError'
    && typeof (error as MulterLikeError).code === 'string'
  );
}

/** What each multer refusal means to whoever sent the request. */
const MULTER_MESSAGES: Record<string, { status: HttpStatus; message: string }> = {
  LIMIT_FILE_SIZE: { status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'That file is too large' },
  LIMIT_FILE_COUNT: { status: HttpStatus.BAD_REQUEST, message: 'Too many files' },
  LIMIT_UNEXPECTED_FILE: { status: HttpStatus.BAD_REQUEST, message: 'Unexpected file field' },
  LIMIT_PART_COUNT: { status: HttpStatus.BAD_REQUEST, message: 'Too many parts in the upload' },
  LIMIT_FIELD_KEY: { status: HttpStatus.BAD_REQUEST, message: 'A field name in the upload is too long' },
  LIMIT_FIELD_VALUE: { status: HttpStatus.BAD_REQUEST, message: 'A field value in the upload is too long' },
  LIMIT_FIELD_COUNT: { status: HttpStatus.BAD_REQUEST, message: 'Too many fields in the upload' },
};

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

    // Express's body parser rejects a request body past its own ceiling by throwing, and what it
    // throws is not an HttpException — so an oversized message came back as 500, our fault rather
    // than the caller's. The schemas now refuse anything long before this is reached; it remains
    // as the honest answer if something ever gets past them.
    if (isPayloadTooLargeError(exception)) {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({ error: 'That request is too large' });
      return;
    }

    if (isUploadLimitError(exception)) {
      const known = MULTER_MESSAGES[exception.code];
      response
        .status(known?.status ?? HttpStatus.BAD_REQUEST)
        .json({ error: known?.message ?? 'That upload was rejected' });
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
