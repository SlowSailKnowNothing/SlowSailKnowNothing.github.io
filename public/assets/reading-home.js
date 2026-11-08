import {readingDuration, validatePublicReading} from './reading-model.js';

export async function loadReadingHome({document: doc = globalThis.document, fetch: fetcher = globalThis.fetch} = {}) {
  const host = doc.getElementById('reading-home');
  if (!host) return;
  fetcher = fetcher.bind(globalThis.window || globalThis);
  const text = doc.createElement('p'); text.className = 'reading-home-line';
  text.textContent = '本周阅读与收听：待同步。';
  const catalog = doc.createElement('p'); catalog.className = 'reading-subtle';
  catalog.textContent = '正在读取公开阅读库。';
  const href = '/reading?open=first', label = '随便读读';
  const link = doc.createElement('a'); link.href = href; link.className = 'detail-link'; link.textContent = label;
  link.setAttribute('data-reading-entry', '');
  host.replaceChildren(text, catalog, link);
  // Links are real-reading entry points even during an error or an empty result.
  for (const entry of doc.querySelectorAll('[data-reading-entry]')) {entry.href = href; entry.textContent = label;}
  await Promise.all([
    (async () => {
      try {
        // Preserve the separately approved weekly statistics, not the old list.
        const response = await fetcher('/data/reading.json', {cache: 'no-store', credentials: 'omit'});
        if (!response.ok) throw new Error('Statistics unavailable');
        const week = validatePublicReading(await response.json()).week;
        text.textContent = !week ? '本周阅读与收听：待同步。' : week.readingSeconds === null && week.listeningSeconds === null
          ? `本周阅读与收听合计 ${readingDuration(week.totalSeconds)}。`
          : `本周阅读 ${readingDuration(week.readingSeconds)}，收听 ${readingDuration(week.listeningSeconds)}。`;
      } catch {text.textContent = '阅读统计暂不可用，不记为 0。';}
    })(),
    (async () => {
      try {
        const response = await fetcher('/api/reading/cards?offset=0&limit=1', {method: 'GET', credentials: 'omit',
          cache: 'no-store', redirect: 'error', headers: {Accept: 'application/json'}});
        if (!response.ok) throw new Error('Public library unavailable');
        const page = await response.json();
        if (typeof page?.version !== 'string' || !page.version || !Number.isSafeInteger(page.snapshotTotal) ||
          page.snapshotTotal < 0 || page.total !== page.snapshotTotal || !Array.isArray(page.items) ||
          page.items.length !== Math.min(1, page.total)) throw new Error('Invalid public library');
        catalog.textContent = page.snapshotTotal ? `随手翻开一张，再沿着关联走走。` : '还没有公开的阅读碎片。';
      } catch {catalog.textContent = '公开阅读库暂不可用，可进入后重新载入。';}
    })(),
  ]);
}

if (globalThis.document?.getElementById('reading-home')) loadReadingHome();
