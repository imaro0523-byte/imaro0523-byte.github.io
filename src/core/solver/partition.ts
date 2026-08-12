/**
 * How many groups, and how many students in each.
 *
 * Two entry points mirror the two ways teachers think about it:
 *   · 방식 A — "I want 6 groups."      → `partitionByCount`
 *   · 방식 B — "I want groups of 4."   → `alternativesForSize`
 *
 * When the numbers do not divide evenly the answer is never an error. It is a
 * list of concrete options with the trade-off of each spelled out.
 */

export interface SizePlan {
  groupCount: number;
  /** Group sizes, largest first. Length always equals `groupCount`. */
  sizes: number[];
  /** Largest minus smallest. The balanced plan always yields 0 or 1. */
  maxDifference: number;
  /**
   * Total distance from the requested size, summed over groups.
   *
   * Summing rather than taking the worst group is what makes the ranking match
   * a teacher's intuition. Asked for groups of 4 from 25 students, six groups
   * (5,4,4,4,4,4) is off by 1 in total, while five groups (5,5,5,5,5) is off by
   * 5 — even though the latter has a perfectly even size difference.
   */
  deviationFromTarget: number;
  /** How many groups do not hold exactly the requested number. */
  offTargetGroups: number;
  /** Plain-language reason this option exists. */
  note: string;
}

export class PartitionError extends Error {
  readonly code: 'noStudents' | 'invalidCount' | 'tooManyGroups' | 'invalidRange' | 'impossible';

  constructor(code: PartitionError['code'], message: string) {
    super(message);
    this.name = 'PartitionError';
    this.code = code;
  }
}

/**
 * Splits `total` students into exactly `groupCount` groups as evenly as
 * possible: `total % groupCount` groups get one extra member, the rest get the
 * floor. The size difference is therefore never more than 1.
 *
 * 25 into 6 → [5, 4, 4, 4, 4, 4]
 * 25 into 7 → [4, 4, 4, 4, 3, 3, 3]
 * 31 into 8 → [4, 4, 4, 4, 4, 4, 4, 3]
 */
export function partitionByCount(total: number, groupCount: number): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new PartitionError('noStudents', '학생 수가 올바르지 않습니다.');
  }
  if (!Number.isInteger(groupCount) || groupCount <= 0) {
    throw new PartitionError('invalidCount', '모둠 수는 1 이상의 정수여야 합니다.');
  }
  if (groupCount > total) {
    throw new PartitionError(
      'tooManyGroups',
      `학생이 ${total}명인데 모둠을 ${groupCount}개로 나눌 수 없습니다. 모둠 수를 ${total}개 이하로 줄여 주세요.`,
    );
  }

  const base = Math.floor(total / groupCount);
  const remainder = total % groupCount;
  const sizes: number[] = [];
  for (let i = 0; i < groupCount; i += 1) sizes.push(i < remainder ? base + 1 : base);
  return sizes;
}

function planFor(total: number, groupCount: number, target: number, note: string): SizePlan {
  const sizes = partitionByCount(total, groupCount);
  const max = Math.max(...sizes);
  const min = Math.min(...sizes);
  return {
    groupCount,
    sizes,
    maxDifference: max - min,
    deviationFromTarget: sizes.reduce((sum, size) => sum + Math.abs(size - target), 0),
    offTargetGroups: sizes.filter((size) => size !== target).length,
    note,
  };
}

export interface SizeOptions {
  /** Desired members per group. */
  target: number;
  min?: number;
  max?: number;
}

/**
 * Every group count that keeps sizes inside `[min, max]`, ranked by how close
 * it lands to the requested size.
 *
 * With 25 students and a target of 4 this yields 6 groups (5,4,4,4,4,4) first,
 * then 7 groups (4,4,4,4,3,3,3), and so on — exactly the options a teacher
 * would work out by hand, with the reason for each spelled out.
 */
export function alternativesForSize(total: number, options: SizeOptions): SizePlan[] {
  const { target } = options;
  const min = options.min ?? Math.max(1, target - 1);
  const max = options.max ?? target + 1;

  if (!Number.isInteger(total) || total <= 0) {
    throw new PartitionError('noStudents', '배치할 학생이 없습니다.');
  }
  if (!Number.isInteger(target) || target <= 0) {
    throw new PartitionError('invalidCount', '모둠 인원은 1 이상의 정수여야 합니다.');
  }
  if (min > max) {
    throw new PartitionError(
      'invalidRange',
      `최소 인원(${min}명)이 최대 인원(${max}명)보다 많습니다. 값을 바꿔 주세요.`,
    );
  }

  const lowestCount = Math.max(1, Math.ceil(total / max));
  const highestCount = Math.min(total, Math.floor(total / min));

  const plans: SizePlan[] = [];
  for (let groupCount = lowestCount; groupCount <= highestCount; groupCount += 1) {
    const sizes = partitionByCount(total, groupCount);
    const largest = Math.max(...sizes);
    const smallest = Math.min(...sizes);
    if (largest > max || smallest < min) continue;

    let note: string;
    if (largest === target && smallest === target) {
      note = `${total}명이 ${target}명씩 정확히 나누어떨어집니다.`;
    } else if (largest - smallest === 0) {
      note = `모든 모둠이 ${largest}명으로 같습니다. 요청하신 ${target}명과는 ${Math.abs(largest - target)}명 차이입니다.`;
    } else {
      const bigCount = sizes.filter((s) => s === largest).length;
      note = `${largest}명 모둠 ${bigCount}개와 ${smallest}명 모둠 ${sizes.length - bigCount}개로 나뉩니다. 인원 차이는 1명입니다.`;
    }
    plans.push(planFor(total, groupCount, target, note));
  }

  if (plans.length === 0) {
    throw new PartitionError(
      'impossible',
      `${total}명을 모둠당 ${min}~${max}명으로는 나눌 수 없습니다. 인원 범위를 넓혀 주세요.`,
    );
  }

  return plans.sort((a, b) => {
    if (a.deviationFromTarget !== b.deviationFromTarget) {
      return a.deviationFromTarget - b.deviationFromTarget;
    }
    if (a.maxDifference !== b.maxDifference) return a.maxDifference - b.maxDifference;
    return a.groupCount - b.groupCount;
  });
}

/**
 * Pair-up plan for 2-person desks, including what to do with the odd student.
 */
export type OddStudentStrategy = 'alone' | 'trio' | 'teacherPicks';

export interface PairPlan {
  pairCount: number;
  /** Number of desks holding three students. Only ever 0 or 1. */
  trioCount: number;
  /** Number of students sitting alone. Only ever 0 or 1. */
  soloCount: number;
  note: string;
}

export function planPairs(total: number, strategy: OddStudentStrategy): PairPlan {
  if (!Number.isInteger(total) || total < 0) {
    throw new PartitionError('noStudents', '학생 수가 올바르지 않습니다.');
  }
  if (total === 0) return { pairCount: 0, trioCount: 0, soloCount: 0, note: '배치할 학생이 없습니다.' };
  if (total % 2 === 0) {
    return {
      pairCount: total / 2,
      trioCount: 0,
      soloCount: 0,
      note: `${total}명이 짝수라 ${total / 2}개 짝으로 나누어집니다.`,
    };
  }

  if (strategy === 'trio') {
    return {
      pairCount: (total - 3) / 2,
      trioCount: 1,
      soloCount: 0,
      note: `${total}명이 홀수라 한 자리를 3인 책상으로 만들었습니다.`,
    };
  }
  return {
    pairCount: (total - 1) / 2,
    trioCount: 0,
    soloCount: 1,
    note:
      strategy === 'teacherPicks'
        ? `${total}명이 홀수입니다. 혼자 앉을 학생을 직접 골라 주세요.`
        : `${total}명이 홀수라 한 명은 혼자 앉습니다.`,
  };
}
