<script setup lang="ts">
import { computed } from 'vue';
import { PATTERN_ILLUSTRATIONS } from '../domain/patterns/illustrations';
import type { CandleIllustrationPrimitive, PatternCardId } from '../domain/patterns/types';

const props = withDefaults(
  defineProps<{
    patternId: PatternCardId;
    decorative?: boolean;
  }>(),
  { decorative: false },
);

const illustration = computed(() => PATTERN_ILLUSTRATIONS[props.patternId]);

function candleBodyTop(candle: CandleIllustrationPrimitive): number {
  return Math.min(candle.open, candle.close);
}

function candleBodyHeight(candle: CandleIllustrationPrimitive): number {
  return Math.max(Math.abs(candle.close - candle.open), 2);
}
</script>

<template>
  <svg
    class="pattern-glyph"
    viewBox="0 0 160 104"
    :role="props.decorative ? undefined : 'img'"
    :aria-label="props.decorative ? undefined : illustration.altTextZhTw"
    :aria-hidden="props.decorative ? 'true' : undefined"
  >
    <title>{{ illustration.title }}</title>
    <desc>{{ illustration.altTextZhTw }}</desc>
    <defs>
      <pattern
        :id="`pattern-glyph-hatch-${props.patternId}`"
        width="5"
        height="5"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="5"
          class="pattern-glyph__hatch-line"
        />
      </pattern>
      <marker
        :id="`pattern-glyph-arrow-${props.patternId}`"
        markerWidth="6"
        markerHeight="6"
        refX="5"
        refY="3"
        orient="auto"
      >
        <path
          d="M 0 0 L 6 3 L 0 6 z"
          class="pattern-glyph__arrow"
        />
      </marker>
    </defs>

    <template
      v-for="(primitive, index) in illustration.primitives"
      :key="`${primitive.kind}-${index}`"
    >
      <g v-if="primitive.kind === 'candle'">
        <line
          :x1="primitive.x"
          :x2="primitive.x"
          :y1="primitive.high"
          :y2="primitive.low"
          class="pattern-glyph__wick"
        />
        <rect
          :x="primitive.x - 6"
          :y="candleBodyTop(primitive)"
          width="12"
          :height="candleBodyHeight(primitive)"
          :class="['pattern-glyph__body', `pattern-glyph__body--${primitive.direction}`]"
        />
        <text
          :x="primitive.x"
          y="101"
          class="pattern-glyph__candle-label"
          text-anchor="middle"
        >{{ primitive.label }}</text>
      </g>
      <line
        v-else-if="primitive.kind === 'trend-line'"
        :x1="primitive.x1"
        :y1="primitive.y1"
        :x2="primitive.x2"
        :y2="primitive.y2"
        class="pattern-glyph__trend-line"
        :marker-end="`url(#pattern-glyph-arrow-${props.patternId})`"
      />
      <rect
        v-else-if="primitive.kind === 'zone'"
        :x="primitive.x"
        :y="primitive.y"
        :width="primitive.width"
        :height="primitive.height"
        class="pattern-glyph__zone"
        :fill="`url(#pattern-glyph-hatch-${props.patternId})`"
      />
      <rect
        v-else-if="primitive.kind === 'volume-bar'"
        :x="primitive.x - 7"
        :y="88 - primitive.height"
        width="14"
        :height="primitive.height"
        class="pattern-glyph__volume-bar"
      />
      <text
        v-else
        :x="primitive.x"
        :y="primitive.y"
        class="pattern-glyph__annotation"
      >{{ primitive.text }}</text>
    </template>
  </svg>
</template>

<style scoped>
.pattern-glyph {
  display: block;
  width: 100%;
  min-height: 10rem;
  overflow: visible;
  color: #2b211d;
}

.pattern-glyph__wick,
.pattern-glyph__trend-line,
.pattern-glyph__hatch-line {
  stroke: currentColor;
  stroke-width: 1.8;
}

.pattern-glyph__trend-line {
  stroke-dasharray: 4 3;
}

.pattern-glyph__arrow {
  fill: currentColor;
}

.pattern-glyph__body {
  stroke: currentColor;
  stroke-width: 1.8;
}

.pattern-glyph__body--up {
  fill: currentColor;
}

.pattern-glyph__body--down {
  fill: var(--vp-c-bg, #fffdf9);
}

.pattern-glyph__body--neutral {
  fill: var(--vp-c-bg, #fffdf9);
  stroke-dasharray: 2 1;
}

.pattern-glyph__zone {
  stroke: currentColor;
  stroke-dasharray: 3 2;
  fill-opacity: 0.2;
}

.pattern-glyph__volume-bar {
  fill: currentColor;
  fill-opacity: 0.55;
  stroke: currentColor;
  stroke-width: 1;
}

.pattern-glyph__annotation,
.pattern-glyph__candle-label {
  fill: currentColor;
  font-size: 7px;
}

.pattern-glyph__candle-label {
  font-size: 5px;
}
</style>
