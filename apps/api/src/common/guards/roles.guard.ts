import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AccountStatusService } from '../account-status.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly accountStatus: AccountStatusService,
  ) {}

  /**
   * The role is read from the account, not from the token that presented it.
   *
   * A JWT carries the role it was issued with, so demoting an administrator left them
   * administering for as long as their token lived — up to eight hours. Tokens are not revocable
   * on their own, which is why the disabled check already works this way; this is the same
   * problem with the same answer, and the lookup is cached for thirty seconds so it costs a
   * round-trip only on the first admin request in that window.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.id) throw new ForbiddenException('Insufficient permissions');

    const role = await this.accountStatus.currentRole(user.id);
    if (!role || !roles.includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
