let currentView = 'episodes'; // 'episodes' | 'manage'
let episodeFilter = 'unwatched'; // 'unwatched' | 'all'
const expandedIds = new Set();

const ICONS = {
  x: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  chevronUp: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentView = btn.dataset.view;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('nav-btn--active'));
      btn.classList.add('nav-btn--active');
      init();
    });
  });
  init();
});

async function init() {
  const animes = await SeasonaStorage.getAll();
  const now = new Date();
  if (currentView === 'episodes') {
    renderEpisodeListView(animes, now);
  } else {
    renderManageView(animes, now);
  }
}

// ---- 視聴可能な配信ビュー ----
function renderEpisodeListView(animes, now) {
  const main = document.getElementById('main');

  const filterHtml = `
    <div class="filter-row">
      <div class="filter-seg">
        <button class="filter-btn${episodeFilter === 'unwatched' ? ' filter-btn--active' : ''}" data-filter="unwatched">未視聴</button>
        <button class="filter-btn${episodeFilter === 'all' ? ' filter-btn--active' : ''}" data-filter="all">全て</button>
      </div>
    </div>
  `;

  const groups = animes.map(anime => {
    const unlocked = SeasonaSchedule.getUnlockedCount(anime, now);
    const watched = new Set(anime.watchedEpisodes ?? []);
    const numToContent = {};
    if (anime.episodeMap) {
      for (const [cid, num] of Object.entries(anime.episodeMap)) {
        numToContent[num] = cid;
      }
    }
    const episodes = [];
    for (let i = 1; i <= unlocked; i++) {
      if (episodeFilter === 'unwatched' && watched.has(i)) continue;
      episodes.push({ num: i, watched: watched.has(i), contentId: numToContent[i] ?? null });
    }
    return { anime, episodes };
  }).filter(g => g.episodes.length > 0);

  const emptyMsg = episodeFilter === 'unwatched'
    ? '未視聴のエピソードはありません'
    : '現在視聴可能なエピソードはありません';

  const listHtml = groups.length === 0
    ? `<div class="empty"><p>${emptyMsg}</p></div>`
    : groups.map(({ anime, episodes }) => `
        <div class="ep-group">
          <div class="ep-group-header">
            <div class="ep-group-title-row">
              <a class="ep-group-title" href="https://tv.dmm.com/vod/detail/?season=${escapeAttr(anime.workId)}" target="_blank">${escapeHtml(anime.title)}</a>
              <span class="card-site">${anime.siteId === 'dmm-anime' ? 'DMM TV' : escapeHtml(anime.siteId)}</span>
            </div>
            <span class="ep-group-count">${episodes.length}話</span>
          </div>
          <div class="ep-list">
            ${episodes.map(ep => renderEpItem(anime, ep)).join('')}
          </div>
        </div>
      `).join('');

  main.innerHTML = filterHtml + listHtml;

  main.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      episodeFilter = btn.dataset.filter;
      await init();
    });
  });

  main.querySelectorAll('[data-action="toggle-watched"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await toggleWatched(btn.dataset.animeId, parseInt(btn.dataset.ep, 10));
      await init();
    });
  });
}

function renderEpItem(anime, ep) {
  const url = ep.contentId
    ? `https://tv.dmm.com/vod/playback/?season=${escapeAttr(anime.workId)}&content=${escapeAttr(ep.contentId)}`
    : null;
  const watchHtml = url
    ? `<a class="ep-watch-btn" href="${url}" target="_blank">視聴する</a>`
    : `<span class="ep-watch-btn ep-watch-btn--none">リンクなし</span>`;
  return `
    <div class="ep-item${ep.watched ? ' ep-item--watched' : ''}">
      <span class="ep-num">第${ep.num}話</span>
      <div class="ep-actions">
        ${watchHtml}
        <button class="ep-toggle${ep.watched ? ' ep-toggle--done' : ''}"
          data-action="toggle-watched"
          data-anime-id="${escapeAttr(anime.id)}"
          data-ep="${ep.num}">
          ${ep.watched ? '未視聴に戻す' : '視聴済みにする'}
        </button>
      </div>
    </div>
  `;
}

async function toggleWatched(animeId, epNum) {
  const all = await SeasonaStorage.getAll();
  const anime = all.find(a => a.id === animeId);
  if (!anime) return;
  const watched = new Set(anime.watchedEpisodes ?? []);
  watched.has(epNum) ? watched.delete(epNum) : watched.add(epNum);
  await SeasonaStorage.save({ ...anime, watchedEpisodes: [...watched] });
}

// ---- 作品管理ビュー ----
function renderManageView(animes, now) {
  const main = document.getElementById('main');

  const toolbarHtml = `
    <div class="data-toolbar">
      <button class="btn-icon" id="btn-export">エクスポート</button>
      <label class="btn-icon" id="btn-import-label">
        インポート
        <input type="file" id="import-input" accept=".json" style="display:none">
      </label>
    </div>
  `;

  const bodyHtml = animes.length === 0
    ? `<div class="empty">
        <p>追体験中のアニメはありません</p>
        <a class="link-dmm" href="https://tv.dmm.com/" target="_blank">DMM TV を開く</a>
       </div>`
    : animes.map(a => renderCard(a, now, !expandedIds.has(a.id))).join('');

  main.innerHTML = toolbarHtml + bodyHtml;

  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await importData(file);
    e.target.value = '';
  });

  main.querySelectorAll('[data-action="toggle-collapse"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const card = btn.closest('.anime-card');
      if (expandedIds.has(id)) {
        expandedIds.delete(id);
        card.classList.add('anime-card--collapsed');
        btn.innerHTML = ICONS.chevronDown;
        btn.setAttribute('aria-label', '展開する');
      } else {
        expandedIds.add(id);
        card.classList.remove('anime-card--collapsed');
        btn.innerHTML = ICONS.chevronUp;
        btn.setAttribute('aria-label', '折りたたむ');
      }
    });
  });

  main.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const anime = animes.find(a => a.id === btn.dataset.id);
      if (anime) openEditModal(anime);
    });
  });

  main.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const anime = animes.find(a => a.id === btn.dataset.id);
      if (!anime) return;
      openConfirmModal(anime.title, async () => {
        await SeasonaStorage.remove(anime.id);
        expandedIds.delete(anime.id);
        await init();
      });
    });
  });
}

// ---- 削除確認モーダル ----
function openConfirmModal(animeTitle, onConfirm) {
  if (document.getElementById('confirm-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'confirm-modal';
  modal.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal modal--sm">
      <div class="modal-header">
        <h2 class="modal-title">削除の確認</h2>
      </div>
      <div class="modal-body">
        <p class="confirm-msg">「${escapeHtml(animeTitle)}」の追体験を削除しますか？</p>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="confirm-cancel">キャンセル</button>
        <button class="btn-danger" id="confirm-ok">削除する</button>
      </div>
    </div>
  `;

  const close = () => modal.remove();
  modal.querySelector('.modal-overlay').addEventListener('click', close);
  modal.querySelector('#confirm-cancel').addEventListener('click', close);
  modal.querySelector('#confirm-ok').addEventListener('click', () => { close(); onConfirm(); });
  document.body.appendChild(modal);
}

// ---- エクスポート / インポート ----
async function exportData() {
  const animes = await SeasonaStorage.getAll();
  const payload = { version: 1, exportedAt: new Date().toISOString(), animes };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seasona-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert('JSONの解析に失敗しました。ファイルを確認してください。');
    return;
  }

  const animes = Array.isArray(payload) ? payload : payload?.animes;
  if (!Array.isArray(animes)) {
    alert('不正なフォーマットです。seasona のエクスポートファイルを使用してください。');
    return;
  }

  const invalid = animes.filter(a => !a.id || !a.title || !a.totalEpisodes || !a.startDate);
  if (invalid.length > 0) {
    alert(`必須フィールドが不足している作品があります: ${invalid.map(a => a.title ?? '(不明)').join(', ')}`);
    return;
  }

  await Promise.all(animes.map(a => SeasonaStorage.save(a)));
  await init();
}

function renderCard(anime, now, isCollapsed = false) {
  const unlocked = SeasonaSchedule.getUnlockedCount(anime, now);
  const pct = Math.round((unlocked / anime.totalEpisodes) * 100);
  const nextUnlock = SeasonaSchedule.getNextUnlockDate(anime, now);
  const startDt = new Date(anime.startDate);
  const siteLabel = anime.siteId === 'dmm-anime' ? 'DMM TV' : escapeHtml(anime.siteId);
  const workUrl = `https://tv.dmm.com/vod/detail/?season=${escapeAttr(anime.workId)}`;

  const nextHtml = nextUnlock
    ? `<div class="card-next">
        <span class="card-next-label">次回解禁</span>
        <span class="card-next-date">${formatDate(nextUnlock)}</span>
       </div>`
    : `<div class="card-next card-next--done">全話解禁済み</div>`;

  const episodesHtml = unlocked > 0
    ? `<div class="card-episodes">
        <div class="card-episodes-label">視聴可能なエピソード</div>
        <div class="card-episodes-list">${buildEpisodeChips(anime, unlocked)}</div>
       </div>`
    : `<div class="card-episodes-empty">まだ視聴可能なエピソードはありません</div>`;

  return `
    <div class="anime-card${isCollapsed ? ' anime-card--collapsed' : ''}">
      <div class="card-header">
        <div class="card-title-row">
          <a class="card-title" href="${workUrl}" target="_blank">${escapeHtml(anime.title)}</a>
          <span class="card-site">${siteLabel}</span>
        </div>
        <div class="card-header-actions">
          <span class="card-progress-inline">${unlocked} / ${anime.totalEpisodes} 話</span>
          <button class="card-collapse-btn" data-action="toggle-collapse" data-id="${escapeAttr(anime.id)}" aria-label="${isCollapsed ? '展開する' : '折りたたむ'}">
            ${isCollapsed ? ICONS.chevronDown : ICONS.chevronUp}
          </button>
          <button class="card-delete" data-action="delete" data-id="${escapeAttr(anime.id)}" aria-label="削除">
            ${ICONS.trash}
          </button>
        </div>
      </div>
      <div class="card-collapsible">
        <div class="card-body">
          <div class="card-progress-row">
            <div class="card-progress-bar">
              <div class="card-progress-fill" style="width:${pct}%"></div>
            </div>
            <span class="card-progress-text">${unlocked} / ${anime.totalEpisodes} 話解禁済み</span>
          </div>
          <div class="card-meta">
            <div class="card-meta-item">
              <span class="card-meta-label">配信スケジュール</span>
              <span class="card-meta-value">${formatScheduleLabel(anime)}</span>
            </div>
            <div class="card-meta-item">
              <span class="card-meta-label">第1話配信日時</span>
              <span class="card-meta-value">${formatDate(startDt)}</span>
            </div>
          </div>
          ${nextHtml}
          ${episodesHtml}
        </div>
        <div class="card-footer">
          <button class="btn-edit" data-action="edit" data-id="${escapeAttr(anime.id)}">設定を編集</button>
        </div>
      </div>
    </div>
  `;
}

function buildEpisodeChips(anime, unlocked) {
  const numToContent = {};
  if (anime.episodeMap) {
    for (const [contentId, epNum] of Object.entries(anime.episodeMap)) {
      numToContent[epNum] = contentId;
    }
  }
  const chips = [];
  for (let i = 1; i <= unlocked; i++) {
    const cid = numToContent[i];
    if (cid) {
      const url = `https://tv.dmm.com/vod/playback/?season=${escapeAttr(anime.workId)}&content=${escapeAttr(cid)}`;
      chips.push(`<a class="ep-chip ep-chip--link" href="${url}" target="_blank">第${i}話</a>`);
    } else {
      chips.push(`<span class="ep-chip">第${i}話</span>`);
    }
  }
  return chips.join('');
}

function formatScheduleLabel(anime) {
  const s = anime.schedule;
  if (s?.type === 'interval') return `${s.intervalDays}日ごと`;
  const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const startDt = new Date(anime.startDate);
  const dow = s?.dayOfWeek ?? startDt.getDay();
  const h = pad(s?.hour ?? startDt.getHours());
  const m = pad(s?.minute ?? startDt.getMinutes());
  return `毎週${DAYS[dow]}曜日 ${h}:${m}`;
}

function formatDate(d) {
  const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${DAYS[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- 編集モーダル ----
function openEditModal(anime) {
  if (document.getElementById('edit-modal')) return;

  const s = anime.schedule;
  const scheduleType = s?.type ?? 'weekly';
  const startDt = new Date(anime.startDate);
  const dateStr = startDt.toISOString().slice(0, 10);
  const timeStr = `${pad(startDt.getHours())}:${pad(startDt.getMinutes())}`;
  const dow = s?.dayOfWeek ?? startDt.getDay();
  const intervalDays = s?.intervalDays ?? 7;

  const DAYS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const dowOptions = DAYS.map((name, i) =>
    `<option value="${i}"${i === dow ? ' selected' : ''}>${name}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.id = 'edit-modal';
  modal.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">設定を編集</h2>
        <button class="modal-close" aria-label="閉じる">${ICONS.x}</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">アニメタイトル</label>
          <input class="field-input" id="edit-title" type="text" value="${escapeAttr(anime.title)}">
        </div>
        <div class="field">
          <label class="field-label">全話数</label>
          <input class="field-input" id="edit-total" type="number" min="1" value="${anime.totalEpisodes}">
        </div>
        <div class="field">
          <label class="field-label">配信スケジュール</label>
          <div class="seg">
            <button type="button" class="seg-btn${scheduleType !== 'interval' ? ' seg-btn--active' : ''}" data-type="weekly">毎週・曜日指定</button>
            <button type="button" class="seg-btn${scheduleType === 'interval' ? ' seg-btn--active' : ''}" data-type="interval">開始日時・間隔指定</button>
          </div>
        </div>
        <div class="field">
          <label class="field-label">第1話の配信日</label>
          <input class="field-input" id="edit-start-date" type="date" value="${dateStr}">
        </div>
        <div id="edit-section-weekly"${scheduleType === 'interval' ? ' style="display:none"' : ''}>
          <div class="field-row">
            <div class="field">
              <label class="field-label">解禁曜日</label>
              <select class="field-input" id="edit-dow">${dowOptions}</select>
            </div>
            <div class="field">
              <label class="field-label">解禁時刻</label>
              <input class="field-input" id="edit-time" type="time" value="${timeStr}">
            </div>
          </div>
        </div>
        <div id="edit-section-interval"${scheduleType !== 'interval' ? ' style="display:none"' : ''}>
          <div class="field-row">
            <div class="field">
              <label class="field-label">配信時刻</label>
              <input class="field-input" id="edit-interval-time" type="time" value="${timeStr}">
            </div>
            <div class="field">
              <label class="field-label">配信間隔（日）</label>
              <input class="field-input" id="edit-interval-days" type="number" min="1" value="${intervalDays}">
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="edit-cancel">キャンセル</button>
        <button class="btn-primary" id="edit-save">保存する</button>
      </div>
    </div>
  `;

  modal.querySelector('.modal-overlay').addEventListener('click', closeEditModal);
  modal.querySelector('.modal-close').addEventListener('click', closeEditModal);
  modal.querySelector('#edit-cancel').addEventListener('click', closeEditModal);
  modal.querySelector('#edit-save').addEventListener('click', () => saveEdit(anime.id));

  modal.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('seg-btn--active'));
      btn.classList.add('seg-btn--active');
      const isInterval = btn.dataset.type === 'interval';
      modal.querySelector('#edit-section-weekly').style.display = isInterval ? 'none' : '';
      modal.querySelector('#edit-section-interval').style.display = isInterval ? '' : 'none';
    });
  });

  document.body.appendChild(modal);
}

function closeEditModal() {
  document.getElementById('edit-modal')?.remove();
}

async function saveEdit(animeId) {
  const all = await SeasonaStorage.getAll();
  const existing = all.find(a => a.id === animeId);
  if (!existing) return;

  const title = document.getElementById('edit-title').value.trim();
  const total = parseInt(document.getElementById('edit-total').value, 10);
  const startDate = document.getElementById('edit-start-date').value;

  if (!title || !total || !startDate) {
    alert('タイトル・全話数・開始日は必須です');
    return;
  }

  const activeBtn = document.querySelector('#edit-modal .seg-btn--active');
  const scheduleType = activeBtn ? activeBtn.dataset.type : 'weekly';

  let startDateTime, schedule;

  if (scheduleType === 'interval') {
    const [hour, minute] = document.getElementById('edit-interval-time').value.split(':').map(Number);
    const intervalDays = parseInt(document.getElementById('edit-interval-days').value, 10);
    if (!intervalDays || intervalDays < 1) {
      alert('配信間隔は1以上の整数を入力してください');
      return;
    }
    startDateTime = new Date(`${startDate}T${pad(hour)}:${pad(minute)}:00`);
    schedule = { type: 'interval', intervalDays, intervalMs: intervalDays * 24 * 60 * 60 * 1000 };
  } else {
    const dow = parseInt(document.getElementById('edit-dow').value, 10);
    const [hour, minute] = document.getElementById('edit-time').value.split(':').map(Number);
    startDateTime = new Date(`${startDate}T${pad(hour)}:${pad(minute)}:00`);
    schedule = { type: 'weekly', dayOfWeek: dow, hour, minute };
  }

  await SeasonaStorage.save({
    ...existing,
    title,
    totalEpisodes: total,
    startDate: startDateTime.toISOString(),
    schedule,
  });

  closeEditModal();
  await init();
}

// ---- ユーティリティ ----
function pad(n) { return String(n).padStart(2, '0'); }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
