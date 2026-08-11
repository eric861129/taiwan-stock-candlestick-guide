---
layout: home
hero:
  name: 台股 K 線筆記
  text: 從描述一根 K 線開始，建立可查核的判讀習慣
  tagline: 給台灣股市初學者的二十章學習路線；看型態，也看背景、限制與風險。
  actions:
    - theme: brand
      text: 開始學習
      link: /learning-path
    - theme: alt
      text: 試用股票型態比對
      link: /analyzer
---

<section class="home-shell" aria-labelledby="home-intro-title">
  <h2 id="home-intro-title">先學會觀察，再談型態</h2>
  <p>
    K 線是某段時間內成交價格的摘要，不是預測未來的水晶球。本網站把觀察事實、條件式解讀、失效條件與風險界線放在同一條學習路線上。
  </p>

  <div class="candle-legend" aria-label="K 線圖例">
    <span class="candle-key"><span class="candle-icon candle-icon--up" aria-hidden="true"></span>收盤高於開盤：實體填滿</span>
    <span class="candle-key"><span class="candle-icon candle-icon--down" aria-hidden="true"></span>收盤低於開盤：實體留白</span>
    <span class="candle-key"><span class="candle-icon candle-icon--flat" aria-hidden="true"></span>開收接近：虛線提示猶豫</span>
  </div>

  <div class="home-shell__grid">
    <article class="home-card">
      <h3>二十章循序練習</h3>
      <p>從 OHLC、影線與成交量開始，逐步讀到結構、型態、指標與案例。</p>
    </article>
    <article class="home-card">
      <h3>三十二張型態卡</h3>
      <p>每張卡都標明可觀察定義、常見誤讀與失效條件，避免把名稱當成訊號。</p>
    </article>
    <article class="home-card">
      <h3>規則比對，不做預測</h3>
      <p>股票比對只回傳符合條件的候選與證據，不提供目標價、勝率或買賣建議。</p>
    </article>
  </div>

  <p class="home-note"><strong>提醒：</strong>內容為教育用途，非投資建議；下單前請依官方規則與自身風險承受度查核。</p>
</section>

<LearningProgressProvider>
  <LearningHome compact />
</LearningProgressProvider>
