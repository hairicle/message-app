import { vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';

/** Model delegates the chat services actually touch. */
const MODELS = [
  'messages',
  'conversations',
  'conversation_members',
  'message_reactions',
  'pinned_messages',
  'user_bookmarks',
  'files',
  'users',
] as const;

const METHODS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findMany',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'groupBy',
] as const;

type MockedModel = Record<(typeof METHODS)[number], ReturnType<typeof vi.fn>>;

/**
 * The Prisma method signatures are replaced with mock types rather than intersected with them —
 * `$queryRaw` is declared as a tagged-template function, so an intersection leaves `.mock` and
 * `.mockResolvedValue` unreachable from the tests.
 */
// Intersected with PrismaService rather than replacing it: the class carries a private field, so
// a structurally-equivalent object is not assignable where a PrismaService is expected. The extra
// members widen the mocked methods to expose .mock and .mockResolvedValue to the tests.
export type PrismaMock = PrismaService & {
  [M in (typeof MODELS)[number]]: MockedModel;
} & {
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

/**
 * A PrismaService stand-in built from vi.fn()s.
 *
 * The point of these tests is the logic around the queries — membership checks, the guards baked
 * into `where` clauses, decoding, mapping and ordering — not that Prisma itself works. Mocking the
 * client keeps them fast and dependency-free while still asserting the exact arguments each query
 * is issued with, which is where the authorisation actually lives.
 */
export function createPrismaMock(): PrismaMock {
  const mock: Record<string, unknown> = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(mock)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  for (const model of MODELS) {
    mock[model] = Object.fromEntries(METHODS.map((m) => [m, vi.fn()]));
  }

  // Only the members the chat services actually call are implemented, so the cast goes through
  // `unknown` — the real PrismaService also carries $on, $extends and the rest of the client.
  return mock as unknown as PrismaMock;
}

/** Convenience: the shape conversation_members.findUnique returns for a member. */
export const MEMBER = { id: 'membership-1' };
