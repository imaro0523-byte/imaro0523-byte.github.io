import { describe, expect, it } from 'vitest';

import {
  alternativesForSize,
  PartitionError,
  partitionByCount,
  planPairs,
} from '@/core/solver/partition';
import { createRng, deriveSeed } from '@/core/solver/rng';

describe('partitionByCount', () => {
  it('splits 25 students into 6 groups as [5,4,4,4,4,4]', () => {
    const sizes = partitionByCount(25, 6);
    expect(sizes).toEqual([5, 4, 4, 4, 4, 4]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(25);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBe(1);
  });

  it('splits 25 students into 7 groups with a size difference of at most 1', () => {
    const sizes = partitionByCount(25, 7);
    expect(sizes).toEqual([4, 4, 4, 4, 3, 3, 3]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(25);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('splits 31 students into 8 groups evenly', () => {
    const sizes = partitionByCount(31, 8);
    expect(sizes).toEqual([4, 4, 4, 4, 4, 4, 4, 3]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(31);
  });

  it('keeps the size difference at 1 or less for every plausible class size', () => {
    for (let total = 1; total <= 40; total += 1) {
      for (let groups = 1; groups <= total; groups += 1) {
        const sizes = partitionByCount(total, groups);
        expect(sizes).toHaveLength(groups);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('refuses more groups than students, with a usable message', () => {
    expect(() => partitionByCount(5, 6)).toThrow(PartitionError);
    try {
      partitionByCount(5, 6);
    } catch (error) {
      expect((error as PartitionError).code).toBe('tooManyGroups');
      expect((error as Error).message).toContain('5개 이하');
    }
  });

  it('refuses zero and negative group counts', () => {
    expect(() => partitionByCount(25, 0)).toThrow(PartitionError);
    expect(() => partitionByCount(25, -3)).toThrow(PartitionError);
  });
});

describe('alternativesForSize', () => {
  it('offers 6 and 7 groups when 25 students are asked to sit in fours', () => {
    const plans = alternativesForSize(25, { target: 4, min: 3, max: 5 });
    const summary = plans.map((p) => ({ count: p.groupCount, sizes: p.sizes }));

    expect(summary).toContainEqual({ count: 6, sizes: [5, 4, 4, 4, 4, 4] });
    expect(summary).toContainEqual({ count: 7, sizes: [4, 4, 4, 4, 3, 3, 3] });
    // Six groups is offered first: only one student sits outside a four, while
    // five groups of five would put every student in an off-target group.
    expect(plans[0]?.groupCount).toBe(6);
    expect(plans[0]?.sizes).toEqual([5, 4, 4, 4, 4, 4]);
    expect(plans[1]?.groupCount).toBe(7);
    expect(plans.every((p) => p.maxDifference <= 1)).toBe(true);
    expect(plans.every((p) => p.sizes.reduce((a, b) => a + b, 0) === 25)).toBe(true);
  });

  it('says so plainly when the split is exact', () => {
    const plans = alternativesForSize(24, { target: 4, min: 4, max: 4 });
    expect(plans[0]?.sizes).toEqual([4, 4, 4, 4, 4, 4]);
    expect(plans[0]?.deviationFromTarget).toBe(0);
    expect(plans[0]?.note).toContain('나누어떨어집니다');
  });

  it('rejects a minimum larger than the maximum', () => {
    expect(() => alternativesForSize(25, { target: 4, min: 6, max: 3 })).toThrow(PartitionError);
    try {
      alternativesForSize(25, { target: 4, min: 6, max: 3 });
    } catch (error) {
      expect((error as PartitionError).code).toBe('invalidRange');
    }
  });

  it('reports impossibility instead of looping forever', () => {
    expect(() => alternativesForSize(7, { target: 4, min: 4, max: 4 })).toThrow(PartitionError);
  });

  it('handles a single student', () => {
    const plans = alternativesForSize(1, { target: 1, min: 1, max: 2 });
    expect(plans[0]?.sizes).toEqual([1]);
  });
});

describe('planPairs', () => {
  it('pairs an even class exactly', () => {
    expect(planPairs(24, 'alone')).toMatchObject({ pairCount: 12, trioCount: 0, soloCount: 0 });
  });

  it('offers a solo seat for an odd class', () => {
    expect(planPairs(25, 'alone')).toMatchObject({ pairCount: 12, trioCount: 0, soloCount: 1 });
  });

  it('offers a three-person desk instead, when asked', () => {
    const plan = planPairs(25, 'trio');
    expect(plan).toMatchObject({ pairCount: 11, trioCount: 1, soloCount: 0 });
    expect(plan.pairCount * 2 + plan.trioCount * 3).toBe(25);
  });

  it('never errors on an odd class', () => {
    for (const strategy of ['alone', 'trio', 'teacherPicks'] as const) {
      expect(() => planPairs(27, strategy)).not.toThrow();
    }
  });
});

describe('seeded random', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const left = Array.from({ length: 20 }, () => a.next());
    const right = Array.from({ length: 20 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces a different sequence for a different seed', () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.next())(createRng(1)));
    const b = Array.from({ length: 20 }, ((r) => () => r.next())(createRng(2)));
    expect(a).not.toEqual(b);
  });

  it('shuffles reproducibly without mutating the input', () => {
    const source = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    const first = createRng(999).shuffle(source);
    const second = createRng(999).shuffle(source);
    expect(first).toEqual(second);
    expect(source).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect([...first].sort()).toEqual([...source].sort());
  });

  it('derives distinct child seeds for multi-start search', () => {
    const seeds = new Set(Array.from({ length: 50 }, (_, i) => deriveSeed(7, i)));
    expect(seeds.size).toBe(50);
  });
});
