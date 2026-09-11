/**
 * Working out the group sizes, in one place.
 *
 * Both the 교실 screen and the 자리 screen need to know what «6모둠» or
 * «모둠당 4명» comes out as for this class. They used to work it out
 * separately, which is how the teacher ended up answering the same question
 * twice and the second answer rebuilt what the first had made.
 */

import { alternativesForSize, partitionByCount, PartitionError, type SizePlan } from './partition';

export interface GroupPlanInput {
  /** Students actually being placed. */
  total: number;
  sizeMode: 'byCount' | 'bySize';
  groupCount: number;
  targetSize: number;
  minSize: number;
  maxSize: number;
}

export interface GroupPlanResult {
  plans: SizePlan[];
  /** A message fit to show a teacher, or null when the plan worked out. */
  error: string | null;
}

export function planGroupSizes(input: GroupPlanInput): GroupPlanResult {
  if (input.total === 0) return { plans: [], error: null };

  try {
    if (input.sizeMode === 'byCount') {
      const sizes = partitionByCount(input.total, input.groupCount);
      const max = Math.max(...sizes);
      const min = Math.min(...sizes);
      return {
        plans: [
          {
            groupCount: input.groupCount,
            sizes,
            maxDifference: max - min,
            deviationFromTarget: 0,
            offTargetGroups: 0,
            note:
              max === min
                ? `${input.total}명이 ${input.groupCount}모둠으로 정확히 나누어떨어집니다.`
                : `${max}명 모둠 ${sizes.filter((s) => s === max).length}개와 ${min}명 모둠 ${sizes.filter((s) => s === min).length}개로 나뉩니다. 인원 차이는 1명입니다.`,
          },
        ],
        error: null,
      };
    }

    return {
      plans: alternativesForSize(input.total, {
        target: input.targetSize,
        min: input.minSize,
        max: input.maxSize,
      }),
      error: null,
    };
  } catch (caught) {
    return {
      plans: [],
      error: caught instanceof PartitionError ? caught.message : '모둠 인원을 계산하지 못했습니다.',
    };
  }
}
