<script setup lang="ts">
import { LEARNING_STAGES } from '../domain/learning/stages';
import type { LearningProgressV1 } from '../domain/learning/progress';
import { SITE_BASE } from '../domain/site/navigation';

const props = defineProps<{ progress: LearningProgressV1 }>();
const emit = defineEmits<{ completeChapter: [chapterId: string] }>();

function stageStatus(stageId: string): string {
  return props.progress.passedStageIds.includes(stageId) ? '已通過' : '尚未通過';
}

function chapterHref(link: string): string {
  return `${SITE_BASE.replace(/\/$/, '')}${link}`;
}

function isChapterCompleted(chapterId: string): boolean {
  return props.progress.completedChapterIds.includes(chapterId);
}
</script>

<template>
  <section
    class="learning-map"
    aria-labelledby="learning-map-title"
  >
    <h2 id="learning-map-title">
      五階段學習地圖
    </h2>
    <p>測驗只記錄進度，不會鎖住章節；你可以依自己的節奏重讀與重試。</p>
    <ol class="learning-map__stages">
      <li
        v-for="stage in LEARNING_STAGES"
        :key="stage.id"
        class="learning-stage"
      >
        <article>
          <div class="learning-stage__heading">
            <h3>{{ stage.title }}</h3>
            <span :data-stage-status="stage.id">{{ stageStatus(stage.id) }}</span>
          </div>
          <p>{{ stage.summary }}</p>
          <ul>
            <li
              v-for="chapter in stage.chapters"
              :key="chapter.id"
            >
              <a :href="chapterHref(chapter.link)">{{ chapter.title }}</a>
              <button
                type="button"
                :aria-pressed="isChapterCompleted(chapter.id)"
                @click="emit('completeChapter', chapter.id)"
              >
                {{ isChapterCompleted(chapter.id) ? '已完成' : '標記完成' }}
              </button>
            </li>
          </ul>
        </article>
      </li>
    </ol>
  </section>
</template>
