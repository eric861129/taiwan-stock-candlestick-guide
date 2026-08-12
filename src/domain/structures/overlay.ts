import type {
  StructureBoundary,
  StructureDirection,
  StructureOverlay,
  StructurePivot,
  StructureStatus,
  StructureWindow,
} from './types';

/** 疊線建構器的輸入完全來自已完成 matcher 評估，不重新計分或判斷型態。 */
export interface StructureOverlayInput {
  candidateId: string;
  window: StructureWindow;
  boundaries: readonly StructureBoundary[];
  anchors: readonly StructurePivot[];
  status: Extract<StructureStatus, 'forming' | 'confirmed'>;
  direction: StructureDirection;
}

function anchorLabel(anchor: StructurePivot): string {
  return anchor.kind === 'high'
    ? `波峰 ${anchor.date}，${anchor.price}`
    : `波谷 ${anchor.date}，${anchor.price}`;
}

function boundarySegments(
  boundaries: readonly StructureBoundary[],
): StructureOverlay['segments'] {
  return boundaries.map((boundary) => ({
    id: `boundary-${boundary.id}`,
    kind: 'boundary',
    label: boundary.id === 'upper' ? '上方邊界／確認線' : '下方邊界／確認線',
    startBarIndex: boundary.startBarIndex,
    startPrice: boundary.startPrice,
    endBarIndex: boundary.endBarIndex,
    endPrice: boundary.endPrice,
    lineStyle: 'solid',
  }));
}

function outlineSegments(anchors: readonly StructurePivot[]): StructureOverlay['segments'] {
  return anchors
    .slice(1)
    .map((anchor, index) => {
      const previous = anchors[index];
      if (!previous) return null;
      return {
        id: `outline-${index}`,
        kind: 'outline' as const,
        label: '轉折輪廓',
        startBarIndex: previous.barIndex,
        startPrice: previous.price,
        endBarIndex: anchor.barIndex,
        endPrice: anchor.price,
        lineStyle: 'dashed' as const,
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null);
}

/**
 * 將已判斷的候選轉成圖表資料座標。所有狀態及方向均由呼叫端傳入，這裡不包含任何 matcher 規則。
 */
export function buildStructureOverlay(input: StructureOverlayInput): StructureOverlay {
  const segments = [...boundarySegments(input.boundaries), ...outlineSegments(input.anchors)];
  const upper = input.boundaries.find((boundary) => boundary.id === 'upper');
  const lower = input.boundaries.find((boundary) => boundary.id === 'lower');

  if (input.status === 'forming') {
    ([
      [upper, 'up', lower],
      [lower, 'down', upper],
    ] as const).forEach(([confirmationBoundary, direction, invalidationBoundary]) => {
      if (confirmationBoundary) {
        segments.push({
          id: `confirmation-${direction}`,
          kind: 'confirmation',
          label: direction === 'up' ? '向上確認線' : '向下確認線',
          startBarIndex: confirmationBoundary.startBarIndex,
          startPrice: confirmationBoundary.startPrice,
          endBarIndex: confirmationBoundary.endBarIndex,
          endPrice: confirmationBoundary.endPrice,
          lineStyle: 'dashed',
        });
      }
      if (invalidationBoundary) {
        segments.push({
          id: `invalidation-after-${direction}`,
          kind: 'invalidation',
          label: direction === 'up' ? '向上確認後的條件式失效線' : '向下確認後的條件式失效線',
          startBarIndex: invalidationBoundary.startBarIndex,
          startPrice: invalidationBoundary.startPrice,
          endBarIndex: invalidationBoundary.endBarIndex,
          endPrice: invalidationBoundary.endPrice,
          lineStyle: 'dashed',
        });
      }
    });
  } else if (input.direction !== 'undetermined') {
    const confirmationBoundary = input.direction === 'up' ? upper : lower;
    const invalidationBoundary = input.direction === 'up' ? lower : upper;
    if (confirmationBoundary) {
      segments.push({
        id: 'confirmation',
        kind: 'confirmation',
        label: input.direction === 'up' ? '向上確認線' : '向下確認線',
        startBarIndex: confirmationBoundary.startBarIndex,
        startPrice: confirmationBoundary.startPrice,
        endBarIndex: confirmationBoundary.endBarIndex,
        endPrice: confirmationBoundary.endPrice,
        lineStyle: 'dashed',
      });
    }
    if (invalidationBoundary) {
      segments.push({
        id: 'invalidation',
        kind: 'invalidation',
        label: input.direction === 'up' ? '向上確認後的失效線' : '向下確認後的失效線',
        startBarIndex: invalidationBoundary.startBarIndex,
        startPrice: invalidationBoundary.startPrice,
        endBarIndex: invalidationBoundary.endBarIndex,
        endPrice: invalidationBoundary.endPrice,
        lineStyle: 'dashed',
      });
    }
  }

  return {
    candidateId: input.candidateId,
    window: input.window,
    segments,
    anchors: input.anchors.map((anchor) => ({
      id: `${anchor.kind}-${anchor.barIndex}`,
      barIndex: anchor.barIndex,
      date: anchor.date,
      price: anchor.price,
      label: anchorLabel(anchor),
    })),
    ...(input.status === 'confirmed' && input.direction !== 'undetermined'
      ? {
        scenario: {
          label: '條件式情境，非價格預測' as const,
          direction: input.direction,
          boundaryId: input.direction === 'up' ? 'upper' as const : 'lower' as const,
        },
      }
      : {}),
  };
}
