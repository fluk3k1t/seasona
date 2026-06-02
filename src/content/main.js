(function () {
  console.log('[seasona] script loaded:', window.location.href);
  const adapter = seasonaAdapter;

  const ICONS = {
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    play: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    lock: `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    circleOff: `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>`,
  };

  // ---- SPA URL 変化の監視 ----
  let lastUrl = '';

  function checkUrlChange() {
    const url = window.location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      onPageChange(url);
    }
  }

  // pushState / replaceState をフック
  const _push = history.pushState.bind(history);
  history.pushState = function (...args) { _push(...args); checkUrlChange(); };

  const _replace = history.replaceState.bind(history);
  history.replaceState = function (...args) { _replace(...args); checkUrlChange(); };

  window.addEventListener('popstate', checkUrlChange);

  // ポーリングでも監視 (フックが効かない遷移に備える)
  setInterval(checkUrlChange, 500);

  // 初回
  lastUrl = window.location.href;
  onPageChange(lastUrl);

  // ---- ページ遷移ハンドラ ----
  function onPageChange(url) {
    console.log('[seasona] onPageChange:', url,
      '| isWork:', adapter.isWorkPage(url),
      '| isEpisode:', adapter.isEpisodePage(url));

    // 既存の seasona UI を除去
    document.getElementById('seasona-track-btn')?.remove();
    document.getElementById('seasona-modal')?.remove();
    document.getElementById('seasona-block-overlay')?.remove();

    if (adapter.isWorkPage(url)) {
      initWorkPage(url);
    } else if (adapter.isEpisodePage(url)) {
      initEpisodePage(url);
    }
  }

  // ---- 作品ページ ----
  async function initWorkPage(url) {
    const workId = adapter.extractWorkId(url);
    if (!workId) return;

    const existing = await SeasonaStorage.getByWorkId(adapter.id, workId);

    // React が描画されるまで待ってからボタン表示
    waitForContent(
      () => document.querySelector('a[href*="content="]') || document.querySelector('h1'),
      () => injectTrackButton(workId, !!existing),
      3000
    );
  }

  // ---- ボタン注入 ----
  function injectTrackButton(workId, alreadyTracked) {
    if (document.getElementById('seasona-track-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'seasona-track-btn';
    btn.className = alreadyTracked ? 'seasona-btn seasona-btn--active' : 'seasona-btn';
    btn.innerHTML = alreadyTracked
      ? `<span class="seasona-btn-icon">${ICONS.check}</span>リアタイ追体験中`
      : `<span class="seasona-btn-icon">${ICONS.play}</span>リアタイ追体験する`;

    if (!alreadyTracked) {
      btn.addEventListener('click', () => showSetupModal(workId));
    }

    document.body.appendChild(btn);
  }

  // ---- エピソードページ ----
  async function initEpisodePage(url) {
    const workId = adapter.extractWorkId(url);
    const contentId = adapter.extractContentId(url);
    if (!workId || !contentId) return;

    const anime = await SeasonaStorage.getByWorkId(adapter.id, workId);

    // 未登録アニメはブロック
    if (!anime) {
      injectBlockOverlay({ type: 'unregistered', workId });
      return;
    }

    // エピソード番号を特定 (episodeMap → DOM の順でフォールバック)
    let episodeNum = anime.episodeMap?.[contentId] ?? null;

    if (episodeNum === null) {
      episodeNum = await waitForEpisodeNumber();
    }

    // 話数不明もブロック (安全側に倒す)
    if (episodeNum === null) {
      injectBlockOverlay({ type: 'unknown', anime });
      return;
    }

    const unlocked = SeasonaSchedule.getUnlockedCount(anime);

    if (episodeNum > unlocked) {
      const nextDate = SeasonaSchedule.getNextUnlockDate(anime);
      injectBlockOverlay({ type: 'locked', episodeNum, unlocked, nextDate, anime });
    } else {
      markAsWatched(anime, episodeNum);
    }
  }

  async function markAsWatched(anime, episodeNum) {
    const watched = new Set(anime.watchedEpisodes ?? []);
    if (watched.has(episodeNum)) return;
    watched.add(episodeNum);
    await SeasonaStorage.save({ ...anime, watchedEpisodes: [...watched] });
  }

  // DOM から第N話を読む。head の title 変化も監視 (React の非同期描画に対応)
  function waitForEpisodeNumber() {
    return new Promise(resolve => {
      function tryExtract() {
        return adapter.extractEpisodeNumber(window.location.href, document);
      }

      const immediate = tryExtract();
      if (immediate !== null) { resolve(immediate); return; }

      // body と head (title) 両方を監視
      const onMutation = () => {
        const num = tryExtract();
        if (num !== null) {
          bodyObs.disconnect();
          headObs.disconnect();
          resolve(num);
        }
      };

      const bodyObs = new MutationObserver(onMutation);
      bodyObs.observe(document.body, { childList: true, subtree: true, characterData: true });

      const headObs = new MutationObserver(onMutation);
      headObs.observe(document.head, { childList: true, subtree: true, characterData: true });

      setTimeout(() => {
        bodyObs.disconnect();
        headObs.disconnect();
        resolve(tryExtract());
      }, 6000);
    });
  }

  // ---- ブロックオーバーレイ ----
  function injectBlockOverlay(opts) {
    if (document.getElementById('seasona-block-overlay')) return;

    let icon, title, msg, sub, next, backHref;
    const seasonId = adapter.extractWorkId(window.location.href);

    if (opts.type === 'unregistered') {
      icon = ICONS.circleOff;
      title = '';
      msg = 'このアニメはリアタイ追体験に登録されていません';
      sub = '視聴するには作品ページから登録してください';
      next = '';
      backHref = `/vod/detail/?season=${seasonId}`;
    } else if (opts.type === 'unknown') {
      icon = ICONS.lock;
      title = escapeHtml(opts.anime.title);
      msg = 'このエピソードは再生できません';
      sub = '話数情報を取得できませんでした。作品ページで一覧を確認してください';
      next = '';
      backHref = `/vod/detail/?season=${seasonId}`;
    } else {
      // type === 'locked'
      const { episodeNum, unlocked, nextDate, anime } = opts;
      const nextStr = nextDate
        ? `${nextDate.getFullYear()}/${nextDate.getMonth() + 1}/${nextDate.getDate()} ${String(nextDate.getHours()).padStart(2, '0')}:${String(nextDate.getMinutes()).padStart(2, '0')} 解禁予定`
        : '';
      icon = ICONS.lock;
      title = escapeHtml(anime.title);
      msg = `第${episodeNum}話はまだ解禁されていません`;
      sub = `現在 ${unlocked} 話まで解禁済み`;
      next = nextStr;
      backHref = `/vod/detail/?season=${seasonId}`;
    }

    const overlay = document.createElement('div');
    overlay.id = 'seasona-block-overlay';
    overlay.innerHTML = `
      <div class="seasona-block-inner">
        <div class="seasona-block-icon">${icon}</div>
        ${title ? `<div class="seasona-block-anime">${title}</div>` : ''}
        <div class="seasona-block-msg">${msg}</div>
        <div class="seasona-block-sub">${sub}</div>
        ${next ? `<div class="seasona-block-next">${escapeHtml(next)}</div>` : ''}
        <a class="seasona-block-back" href="${backHref}">作品ページに戻る</a>
      </div>
    `;

    document.body.appendChild(overlay);

    // React が overlay を削除しようとしても再挿入する
    const guard = new MutationObserver(() => {
      if (!document.getElementById('seasona-block-overlay')) {
        document.body.appendChild(overlay);
      }
    });
    guard.observe(document.body, { childList: true });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- 設定モーダル ----
  function showSetupModal(workId) {
    if (document.getElementById('seasona-modal')) return;

    const { title, totalEpisodes } = adapter.extractWorkInfo(document);

    const overlay = document.createElement('div');
    overlay.id = 'seasona-modal';
    overlay.innerHTML = `
      <div class="seasona-overlay"></div>
      <div class="seasona-modal">
        <div class="seasona-modal-header">
          <h2 class="seasona-modal-title">リアタイ追体験の設定</h2>
          <button class="seasona-modal-close" aria-label="閉じる">${ICONS.x}</button>
        </div>
        <div class="seasona-modal-body">
          <div class="seasona-field">
            <label class="seasona-label">アニメタイトル</label>
            <input class="seasona-input" id="seasona-title" type="text"
              value="${escapeAttr(title || '')}" placeholder="タイトルを入力">
          </div>
          <div class="seasona-field">
            <label class="seasona-label">全話数</label>
            <input class="seasona-input" id="seasona-total" type="number"
              min="1" value="${totalEpisodes || ''}" placeholder="例: 12">
          </div>
          <div class="seasona-field">
            <label class="seasona-label">配信スケジュール</label>
            <div class="seasona-seg">
              <button type="button" class="seasona-seg-btn seasona-seg-btn--active" data-type="weekly">毎週・曜日指定</button>
              <button type="button" class="seasona-seg-btn" data-type="interval">開始日時・間隔指定</button>
            </div>
          </div>
          <div class="seasona-field">
            <label class="seasona-label">第1話の配信日</label>
            <input class="seasona-input" id="seasona-start-date" type="date">
          </div>
          <div id="seasona-section-weekly">
            <div class="seasona-field-row">
              <div class="seasona-field">
                <label class="seasona-label">解禁曜日</label>
                <select class="seasona-select" id="seasona-dow">
                  <option value="0">日曜日</option>
                  <option value="1">月曜日</option>
                  <option value="2">火曜日</option>
                  <option value="3">水曜日</option>
                  <option value="4">木曜日</option>
                  <option value="5">金曜日</option>
                  <option value="6">土曜日</option>
                </select>
              </div>
              <div class="seasona-field">
                <label class="seasona-label">解禁時刻</label>
                <input class="seasona-input" id="seasona-time" type="time" value="00:00">
              </div>
            </div>
          </div>
          <div id="seasona-section-interval" style="display:none">
            <div class="seasona-field-row">
              <div class="seasona-field">
                <label class="seasona-label">配信時刻</label>
                <input class="seasona-input" id="seasona-interval-time" type="time" value="00:00">
              </div>
              <div class="seasona-field">
                <label class="seasona-label">配信間隔（日）</label>
                <input class="seasona-input" id="seasona-interval-days" type="number" min="1" value="7">
              </div>
            </div>
          </div>
        </div>
        <div class="seasona-modal-footer">
          <button class="seasona-btn-unlock-all" id="seasona-unlock-all">全話を解禁する</button>
          <button class="seasona-btn-secondary" id="seasona-cancel">キャンセル</button>
          <button class="seasona-btn-primary" id="seasona-save">追体験を開始する</button>
        </div>
      </div>
    `;

    overlay.querySelector('.seasona-overlay').addEventListener('click', closeModal);
    overlay.querySelector('.seasona-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('#seasona-cancel').addEventListener('click', closeModal);
    overlay.querySelector('#seasona-unlock-all').addEventListener('click', () => unlockAllEpisodes(workId));
    overlay.querySelector('#seasona-save').addEventListener('click', () => saveAnime(workId));

    document.body.appendChild(overlay);

    overlay.querySelectorAll('.seasona-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.seasona-seg-btn').forEach(b => b.classList.remove('seasona-seg-btn--active'));
        btn.classList.add('seasona-seg-btn--active');
        const isInterval = btn.dataset.type === 'interval';
        overlay.querySelector('#seasona-section-weekly').style.display = isInterval ? 'none' : '';
        overlay.querySelector('#seasona-section-interval').style.display = isInterval ? '' : 'none';
      });
    });
  }

  // ---- 保存 ----
  async function saveAnime(workId) {
    const title = document.getElementById('seasona-title').value.trim();
    const total = parseInt(document.getElementById('seasona-total').value, 10);
    const startDate = document.getElementById('seasona-start-date').value;

    if (!title || !total || !startDate) {
      alert('タイトル・全話数・開始日は必須です');
      return;
    }

    const activeBtn = document.querySelector('.seasona-seg-btn--active');
    const scheduleType = activeBtn ? activeBtn.dataset.type : 'weekly';

    let startDateTime, schedule;

    if (scheduleType === 'interval') {
      const [hour, minute] = document.getElementById('seasona-interval-time').value.split(':').map(Number);
      const intervalDays = parseInt(document.getElementById('seasona-interval-days').value, 10);
      if (!intervalDays || intervalDays < 1) {
        alert('配信間隔は1以上の整数を入力してください');
        return;
      }
      startDateTime = new Date(
        `${startDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
      );
      schedule = { type: 'interval', intervalDays, intervalMs: intervalDays * 24 * 60 * 60 * 1000 };
    } else {
      const dow = parseInt(document.getElementById('seasona-dow').value, 10);
      const [hour, minute] = document.getElementById('seasona-time').value.split(':').map(Number);
      startDateTime = new Date(
        `${startDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
      );
      schedule = { type: 'weekly', dayOfWeek: dow, hour, minute };
    }

    // エピソードマップも一緒に保存 (contentId → episodeNumber)
    const episodeMap = adapter.buildEpisodeMap(document);

    const anime = {
      id: crypto.randomUUID(),
      title,
      siteId: adapter.id,
      workId,
      workUrl: window.location.href,
      startDate: startDateTime.toISOString(),
      schedule,
      totalEpisodes: total,
      episodeMap,
    };

    await SeasonaStorage.save(anime);
    closeModal();

    const btn = document.getElementById('seasona-track-btn');
    if (btn) {
      btn.className = 'seasona-btn seasona-btn--active';
      btn.innerHTML = `<span class="seasona-btn-icon">${ICONS.check}</span>リアタイ追体験中`;
      btn.onclick = null;
    }
  }

  // ---- 全話解禁 ----
  async function unlockAllEpisodes(workId) {
    const title = document.getElementById('seasona-title').value.trim();
    const total = parseInt(document.getElementById('seasona-total').value, 10);

    if (!title || !total) {
      alert('タイトルと全話数を入力してから実行してください');
      return;
    }

    const confirmed = confirm(
      `「${title}」の全${total}話を今すぐ解禁しますか？\n\n` +
      `すべてのエピソードが視聴可能な状態で登録されます。\n` +
      `この操作はリアタイ追体験の開始日を過去に設定することで行われます。`
    );
    if (!confirmed) return;

    const activeBtn = document.querySelector('.seasona-seg-btn--active');
    const scheduleType = activeBtn ? activeBtn.dataset.type : 'weekly';

    let schedule, intervalMs;

    if (scheduleType === 'interval') {
      const intervalDays = parseInt(document.getElementById('seasona-interval-days').value, 10) || 7;
      intervalMs = intervalDays * 24 * 60 * 60 * 1000;
      schedule = { type: 'interval', intervalDays, intervalMs };
    } else {
      const dow = parseInt(document.getElementById('seasona-dow').value, 10);
      const [hour, minute] = document.getElementById('seasona-time').value.split(':').map(Number);
      intervalMs = 7 * 24 * 60 * 60 * 1000;
      schedule = { type: 'weekly', dayOfWeek: dow, hour, minute };
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - total * intervalMs);
    const episodeMap = adapter.buildEpisodeMap(document);

    const anime = {
      id: crypto.randomUUID(),
      title,
      siteId: adapter.id,
      workId,
      workUrl: window.location.href,
      startDate: startDate.toISOString(),
      schedule,
      totalEpisodes: total,
      episodeMap,
    };

    await SeasonaStorage.save(anime);
    closeModal();

    const btn = document.getElementById('seasona-track-btn');
    if (btn) {
      btn.className = 'seasona-btn seasona-btn--active';
      btn.innerHTML = `<span class="seasona-btn-icon">${ICONS.check}</span>リアタイ追体験中`;
      btn.onclick = null;
    }
  }

  // ---- ユーティリティ ----
  function closeModal() {
    document.getElementById('seasona-modal')?.remove();
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // condition() が truthy になるまで MutationObserver で待つ
  function waitForContent(condition, callback, timeoutMs = 3000) {
    if (condition()) { callback(); return; }

    const observer = new MutationObserver(() => {
      if (condition()) {
        observer.disconnect();
        callback();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      callback(); // タイムアウト後も実行 (タイトルだけでも表示)
    }, timeoutMs);
  }
})();
