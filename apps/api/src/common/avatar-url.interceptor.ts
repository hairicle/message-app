import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { AvatarUrlService } from './avatar-url.service';

// Only these exact keys are rewritten. Avatars are emitted from six places across four services,
// two of them assembled inside SQL json_build_object, so handling it per-service would make
// missing one a silent regression that re-exposes a photo.
const AVATAR_KEYS = new Set(['avatar_url', 'avatarUrl']);

/** Dates, Buffers, class instances and the like must be passed through untouched. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Rewrites stored avatar references into short-lived signed URLs on the way out. */
@Injectable()
export class AvatarUrlInterceptor implements NestInterceptor {
  constructor(private readonly avatars: AvatarUrlService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(mergeMap((body) => from(this.rewrite(body))));
  }

  private async rewrite(node: unknown, depth = 0): Promise<unknown> {
    // Guards against a pathological payload walking forever; real responses nest a few levels.
    if (node === null || typeof node !== 'object' || depth > 8) return node;

    if (Array.isArray(node)) {
      return Promise.all(node.map((item) => this.rewrite(item, depth + 1)));
    }

    // Only descend into plain objects. Rebuilding a Date key-by-key yields {}, which serialises
    // as {} and reaches the client as an unparseable timestamp — pg returns every timestamptz
    // column as a Date instance, so this silently broke every message time.
    if (!isPlainObject(node)) return node;

    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    await Promise.all(
      Object.entries(source).map(async ([key, value]) => {
        if (AVATAR_KEYS.has(key) && typeof value === 'string' && value.length > 0) {
          out[key] = await this.avatars.resolve(value);
        } else {
          out[key] = await this.rewrite(value, depth + 1);
        }
      }),
    );
    return out;
  }
}
