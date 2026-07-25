(function () {
  "use strict";

  const DATA_URL = "/now/data.json";
  const ROOT_ID = "now-dashboard-root";
  const DAY_MS = 24 * 60 * 60 * 1000;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseLocalDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDate(value) {
    if (!value) return "尚未记录";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(parseLocalDate(value));
  }

  function formatMinutes(value) {
    if (!Number.isFinite(value)) return "--";
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    if (!hours) return `${minutes} 分钟`;
    if (!minutes) return `${hours} 小时`;
    return `${hours} 小时 ${minutes} 分`;
  }

  function recordScore(record) {
    if (!record || !record.habits) {
      return { completed: 0, total: 0, ratio: null };
    }

    const values = Object.values(record.habits).filter(
      (value) => value === true || value === false
    );
    const completed = values.filter(Boolean).length;

    return {
      completed,
      total: values.length,
      ratio: values.length ? completed / values.length : null
    };
  }

  function scoreLevel(ratio) {
    if (ratio === null) return 0;
    if (ratio >= 0.8) return 4;
    if (ratio >= 0.6) return 3;
    if (ratio >= 0.4) return 2;
    if (ratio > 0) return 1;
    return 0;
  }

  function buildRecordMap(records) {
    return new Map((records || []).map((record) => [record.date, record]));
  }

  function getRecentRecords(records, days) {
    const map = buildRecordMap(records);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = [];

    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(today.getTime() - offset * DAY_MS);
      const key = dateKey(date);
      result.push({ date: key, record: map.get(key) || null });
    }

    return result;
  }

  function calculateRecentRatio(records, days) {
    const recent = getRecentRecords(records, days)
      .map(({ record }) => recordScore(record))
      .filter(({ ratio }) => ratio !== null);

    if (!recent.length) return null;
    return recent.reduce((sum, item) => sum + item.ratio, 0) / recent.length;
  }

  function calculateStreak(records) {
    const map = buildRecordMap(records);
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    let streak = 0;

    while (true) {
      const record = map.get(dateKey(cursor));
      const { ratio } = recordScore(record);
      if (ratio === null || ratio < 0.6) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  }

  function heatmapHtml(records) {
    const map = buildRecordMap(records);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - start.getDay());

    const cells = [];
    for (
      let cursor = new Date(start);
      cursor <= today;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const key = dateKey(cursor);
      const record = map.get(key);
      const score = recordScore(record);
      const title =
        score.ratio === null
          ? `${key} · 未记录`
          : `${key} · 完成 ${score.completed}/${score.total}`;

      cells.push(
        `<span class="now-day" data-level="${scoreLevel(
          score.ratio
        )}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"></span>`
      );
    }

    const remainder = cells.length % 7;
    if (remainder) {
      for (let index = remainder; index < 7; index += 1) {
        cells.push('<span class="now-day is-future" aria-hidden="true"></span>');
      }
    }

    return cells.join("");
  }

  function habitsHtml(definitions, record) {
    if (!record) {
      return '<p class="now-empty">今天尚未完成复盘。晚间记录后，这里会显示每项习惯的完成情况。</p>';
    }

    return `<ul class="now-habits">${definitions
      .map((habit) => {
        const value = record.habits?.[habit.id];
        const state =
          value === true ? "is-done" : value === false ? "is-missed" : "";
        const label =
          value === true ? "已完成" : value === false ? "未完成" : "未安排";

        return `<li class="now-habit">
          <span>${escapeHtml(habit.label)}</span>
          <span class="now-habit-mark ${state}" title="${label}" aria-label="${label}"></span>
        </li>`;
      })
      .join("")}</ul>`;
  }

  function focusHtml(items) {
    return items
      .map(
        (item, index) => `<li class="now-focus-item">
          <span class="now-focus-index">${String(index + 1).padStart(2, "0")}</span>
          <span>${escapeHtml(item)}</span>
        </li>`
      )
      .join("");
  }

  function principlesHtml(items) {
    return items
      .map((item) => `<span class="now-principle">${escapeHtml(item)}</span>`)
      .join("");
  }

  function render(data) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const todayKey = dateKey(new Date());
    const recordMap = buildRecordMap(data.records);
    const todayRecord = recordMap.get(todayKey) || null;
    const todayScore = recordScore(todayRecord);
    const recentRatio = calculateRecentRatio(data.records, 7);
    const streak = calculateStreak(data.records);

    const scoreText =
      todayScore.ratio === null
        ? "--"
        : `${Math.round(todayScore.ratio * 100)}%`;
    const scoreNote =
      todayScore.ratio === null
        ? "等待今晚复盘"
        : `完成 ${todayScore.completed}/${todayScore.total} 项`;
    const recentText =
      recentRatio === null ? "--" : `${Math.round(recentRatio * 100)}%`;

    root.innerHTML = `<div class="now-dashboard">
      <div class="now-shell">
        <section class="now-hero" aria-labelledby="now-title">
          <div class="now-hero-meta">
            <p class="now-eyebrow">personal agent / runtime</p>
            <span class="now-live">系统在线</span>
          </div>
          <h1 id="now-title">${escapeHtml(data.statement)}</h1>
          <p class="now-hero-intro">这里公开记录我此刻真正关注的事情，以及那些需要日复一日维护的生活状态。</p>
          <p class="now-updated">最后更新于 ${escapeHtml(formatDate(data.updatedAt))}</p>
        </section>

        <section class="now-stat-grid" aria-label="今日运行状态">
          <article class="now-stat">
            <p class="now-stat-label">今日习惯</p>
            <p class="now-stat-value">${scoreText}</p>
            <p class="now-stat-note">${scoreNote}</p>
          </article>
          <article class="now-stat">
            <p class="now-stat-label">手机使用</p>
            <p class="now-stat-value">${escapeHtml(
              formatMinutes(todayRecord?.screenTimeMinutes)
            )}</p>
            <p class="now-stat-note">目标 ≤ ${escapeHtml(
              formatMinutes(data.screenTimeGoalMinutes)
            )}</p>
          </article>
          <article class="now-stat">
            <p class="now-stat-label">七日稳定度</p>
            <p class="now-stat-value">${recentText}</p>
            <p class="now-stat-note">最近有记录日期的平均完成度</p>
          </article>
          <article class="now-stat">
            <p class="now-stat-label">连续稳定</p>
            <p class="now-stat-value">${streak} 天</p>
            <p class="now-stat-note">每日完成度达到 60% 以上</p>
          </article>
        </section>

        <section class="now-section-grid">
          <article class="now-card">
            <div class="now-card-head">
              <div>
                <p class="now-eyebrow">habit heartbeat</p>
                <h2>习惯热力图</h2>
                <p class="now-card-description">颜色越深，代表当天坚持的习惯越多。空白不是失败，只是诚实地留下没有运行起来的日子。</p>
              </div>
            </div>
            <div class="now-heatmap-scroll" tabindex="0" aria-label="过去一年的习惯完成热力图">
              <div class="now-heatmap">${heatmapHtml(data.records)}</div>
            </div>
            <div class="now-legend" aria-label="热力图颜色说明">
              <span>少</span>
              <span class="now-day" data-level="0"></span>
              <span class="now-day" data-level="1"></span>
              <span class="now-day" data-level="2"></span>
              <span class="now-day" data-level="3"></span>
              <span class="now-day" data-level="4"></span>
              <span>多</span>
            </div>
          </article>

          <article class="now-card">
            <p class="now-eyebrow">today / ${todayKey}</p>
            <h2>今天的习惯</h2>
            ${habitsHtml(data.habitDefinitions, todayRecord)}
          </article>
        </section>

        <section class="now-focus-grid">
          <article class="now-card">
            <p class="now-eyebrow">current focus</p>
            <h2>当前公开主线</h2>
            <ol class="now-focus-list">${focusHtml(data.focus)}</ol>
          </article>
          <article class="now-card">
            <p class="now-eyebrow">principles</p>
            <h2>正在遵循的原则</h2>
            <div class="now-principles">${principlesHtml(data.principles)}</div>
          </article>
        </section>

        <section class="now-mission-grid">
          <article class="now-card">
            <p class="now-eyebrow">mission</p>
            <p>${escapeHtml(data.mission)}</p>
          </article>
          <article class="now-card">
            <p class="now-eyebrow">vision</p>
            <p>${escapeHtml(data.vision)}</p>
          </article>
        </section>
      </div>
    </div>`;
  }

  async function renderNowDashboard() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load dashboard data");
      render(await response.json());
    } catch (error) {
      root.innerHTML = `<div class="now-error">
        <p class="now-eyebrow">runtime error</p>
        <h1>此刻页面暂时没有读取到数据。</h1>
        <p>请稍后刷新重试。</p>
      </div>`;
    }
  }

  window.renderNowDashboard = renderNowDashboard;
  window.__nowDashboardReady = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderNowDashboard, {
      once: true
    });
  } else {
    renderNowDashboard();
  }
})();
