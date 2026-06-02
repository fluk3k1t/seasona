function getUnlockedCount(anime, now = new Date()) {
  const start = new Date(anime.startDate);
  if (now < start) return 0;
  const intervalMs = anime.schedule?.intervalMs ?? (7 * 24 * 60 * 60 * 1000);
  return Math.min(Math.floor((now - start) / intervalMs) + 1, anime.totalEpisodes);
}

document.getElementById('btn-manage').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.addEventListener('DOMContentLoaded', async () => {
  const main = document.getElementById('main');
  const result = await chrome.storage.sync.get(null);

  const animes = Object.entries(result)
    .filter(([k]) => k.startsWith('anime_'))
    .map(([, v]) => v);

  if (animes.length === 0) {
    main.innerHTML = `
      <div class="empty">
        <p>追体験中のアニメはありません</p>
        <a class="link-dmm" href="https://anime.dmm.co.jp/" target="_blank">DMM アニメを開く</a>
      </div>
    `;
    return;
  }

  const now = new Date();
  main.innerHTML = animes.map(a => {
    const unlocked = getUnlockedCount(a, now);
    const pct = Math.round((unlocked / a.totalEpisodes) * 100);
    return `
      <div class="anime-item">
        <div class="anime-title">${escapeHtml(a.title)}</div>
        <div class="anime-status">${unlocked} / ${a.totalEpisodes} 話</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
});

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
