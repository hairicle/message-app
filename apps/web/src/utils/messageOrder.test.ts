import { describe, it, expect } from 'vitest';
import { compareMessages } from './messageOrder';

const m = (id: string, iso: string) => ({ id, createdAt: iso });
const at = (hhmmss: string) => `2026-08-07T${hhmmss}.000Z`;

describe('compareMessages', () => {
  it('orders by time when the times differ', () => {
    expect(compareMessages(m('b', at('15:09:00')), m('a', at('15:14:00')))).toBeLessThan(0);
    expect(compareMessages(m('a', at('15:14:00')), m('b', at('15:09:00')))).toBeGreaterThan(0);
  });

  // The reason this exists. `created_at` defaults to now(), which is the *transaction* timestamp —
  // identical for every row written in one transaction. Left to the timestamp alone, the order was
  // the database's discretion on one side and arrival order on the other, and they could disagree
  // permanently.
  describe('when two messages share a timestamp', () => {
    const same = at('15:09:00');

    it('breaks the tie by id', () => {
      expect(compareMessages(m('aaa', same), m('bbb', same))).toBeLessThan(0);
      expect(compareMessages(m('bbb', same), m('aaa', same))).toBeGreaterThan(0);
    });

    // Lexicographic, because that is what Postgres does for a uuid — so the tiebreak agrees with
    // the server rather than merely being consistent with itself.
    it('compares ids lexicographically, as Postgres does for a uuid', () => {
      const lo = '0a000000-0000-4000-8000-000000000000';
      const hi = 'f0000000-0000-4000-8000-000000000000';
      expect(compareMessages(m(lo, same), m(hi, same))).toBeLessThan(0);
    });

    it('reports the same message as equal', () => {
      expect(compareMessages(m('a', same), m('a', same))).toBe(0);
    });
  });

  // A comparator that is not a total order sorts unstably, which is the whole problem restated.
  it('gives a stable, total order over a tied set', () => {
    const same = at('15:09:00');
    const items = [m('d', same), m('b', same), m('c', same), m('a', same)];
    const once = [...items].sort(compareMessages).map((x) => x.id);
    const twice = [...items].reverse().sort(compareMessages).map((x) => x.id);
    expect(once).toEqual(['a', 'b', 'c', 'd']);
    expect(twice).toEqual(once);
  });

  it('sorts a mixed set by time first, then id', () => {
    const out = [
      m('z', at('15:10:00')),
      m('b', at('15:09:00')),
      m('a', at('15:09:00')),
    ].sort(compareMessages).map((x) => x.id);
    expect(out).toEqual(['a', 'b', 'z']);
  });
});
