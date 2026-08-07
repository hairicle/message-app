import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AccountStatusService } from '../account-status.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly accountStatus: AccountStatusService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const can = await super.canActivate(context);
    if (!can) return false;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string; scope?: string };

    // Reject TOTP-pending tokens on fully-authenticated routes
    if (user.scope === 'totp_pending') {
      throw new UnauthorizedException('Complete TOTP verification first');
    }

    await this.accountStatus.assertActive(user.id);
    return true;
  }

  handleRequest<T>(err: Error | null, user: T): T {
    if (err || !user) throw new UnauthorizedException('Invalid or expired token');
    return user;
  }
}
