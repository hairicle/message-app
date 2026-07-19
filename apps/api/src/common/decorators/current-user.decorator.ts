import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthPayload } from '@messenger/shared';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthPayload;
  },
);
