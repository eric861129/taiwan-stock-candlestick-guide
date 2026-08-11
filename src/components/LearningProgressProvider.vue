<script setup lang="ts">
import type { ProgressStorage } from '../domain/learning/progress';
import { provideLearningProgress } from './learningProgressContext';

const props = defineProps<{ storage?: ProgressStorage }>();
provideLearningProgress(props.storage);
</script>

<template>
  <slot />
</template>
