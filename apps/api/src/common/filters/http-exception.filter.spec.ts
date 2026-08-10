import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { HttpExceptionFilter } from './http-exception.filter';

/** Captures what the filter wrote, in the shape Express hands it. */
function makeResponse() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { sent.status = code; return this; },
    json(body: unknown) { sent.body = body; return this; },
  };
  return { res, sent };
}

const hostFor = (res: unknown) => ({ switchToHttp: () => ({ getResponse: () => res }) }) as never;

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    // The filter logs unhandled exceptions; quiet in tests, and asserted where it matters.
    vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  const thrownBy = (schema: z.ZodTypeAny, value: unknown) => {
    try { schema.parse(value); } catch (err) { return err; }
    throw new Error('schema unexpectedly accepted the value');
  };

  describe('a schema rejecting the request body', () => {
    const loginSchema = z.object({ email: z.string(), password: z.string() });

    // The bug: a ZodError is not an HttpException, so it fell through to the catch-all and came
    // back as 500 "Internal server error" on every malformed request.
    it('answers 400, not 500', () => {
      const { res, sent } = makeResponse();
      filter.catch(thrownBy(loginSchema, { password: 'x' }), hostFor(res));
      expect(sent.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('names the field that was wrong', () => {
      const { res, sent } = makeResponse();
      filter.catch(thrownBy(loginSchema, { password: 'x' }), hostFor(res));
      expect(sent.body).toMatchObject({
        error: 'Invalid request',
        fields: [{ field: 'email' }],
      });
    });

    it('reports every problem, not only the first', () => {
      const { res, sent } = makeResponse();
      filter.catch(thrownBy(loginSchema, {}), hostFor(res));
      const fields = (sent.body as { fields: { field: string }[] }).fields.map((f) => f.field);
      expect(fields).toEqual(['email', 'password']);
    });

    it('names a nested field by its path', () => {
      const nested = z.object({ user: z.object({ name: z.string() }) });
      const { res, sent } = makeResponse();
      filter.catch(thrownBy(nested, { user: {} }), hostFor(res));
      expect(sent.body).toMatchObject({ fields: [{ field: 'user.name' }] });
    });

    it('says "(body)" when the whole payload is the wrong shape', () => {
      const { res, sent } = makeResponse();
      filter.catch(thrownBy(loginSchema, 'not an object'), hostFor(res));
      expect(sent.body).toMatchObject({ fields: [{ field: '(body)' }] });
    });

    // A malformed request is the caller's fault; logging it as a server fault buried real ones.
    it('does not log it as an unhandled exception', () => {
      const { res } = makeResponse();
      filter.catch(thrownBy(loginSchema, {}), hostFor(res));
      expect(filter['logger'].error).not.toHaveBeenCalled();
    });
  });

  describe('everything else is unchanged', () => {
    it('passes an HttpException through with its own status', () => {
      const { res, sent } = makeResponse();
      filter.catch(new ForbiddenException('Nope'), hostFor(res));
      expect(sent.status).toBe(HttpStatus.FORBIDDEN);
      expect(sent.body).toEqual({ error: 'Nope' });
    });

    it('keeps the message from an exception carrying an object body', () => {
      const { res, sent } = makeResponse();
      filter.catch(new BadRequestException({ message: 'Too large' }), hostFor(res));
      expect(sent.body).toEqual({ error: 'Too large' });
    });

    it('still answers 500 for a genuine fault, and logs it', () => {
      const { res, sent } = makeResponse();
      filter.catch(new Error('database on fire'), hostFor(res));
      expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(sent.body).toEqual({ error: 'Internal server error' });
      expect(filter['logger'].error).toHaveBeenCalled();
    });

    // An object that merely looks similar must not be mistaken for a validation failure.
    it('does not treat any error with an issues array as a validation failure', () => {
      const { res, sent } = makeResponse();
      filter.catch(Object.assign(new Error('nope'), { issues: [] }), hostFor(res));
      expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('answers 500 rather than throwing when handed something that is not an error', () => {
      const { res, sent } = makeResponse();
      filter.catch('a bare string', hostFor(res));
      expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  it('leaves an HttpException that is also shaped like a validation error alone', () => {
    const { res, sent } = makeResponse();
    filter.catch(new HttpException('Teapot', 418), hostFor(res));
    expect(sent.status).toBe(418);
  });
});
