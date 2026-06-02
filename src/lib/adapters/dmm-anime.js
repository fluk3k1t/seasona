// DMM TV (tv.dmm.com) 用アダプター
// GraphQL エンドポイント: https://api.tv.dmm.com/graphql
class DmmAnimeAdapter {
  get id() {
    return 'dmm-anime';
  }

  // 作品ページ: ?season=xxx (content パラメーターなし)
  isWorkPage(url) {
    const u = new URL(url);
    return u.hostname === 'tv.dmm.com'
      && u.pathname === '/vod/detail/'
      && u.searchParams.has('season')
      && !u.searchParams.has('content');
  }

  // エピソード再生ページ: /vod/playback/ 配下で season と content 両方あり
  isEpisodePage(url) {
    const u = new URL(url);
    return u.hostname === 'tv.dmm.com'
      && u.pathname.startsWith('/vod/playback/')
      && u.searchParams.has('season')
      && u.searchParams.has('content');
  }

  // season ID を作品 ID として返す
  extractWorkId(url) {
    return new URL(url).searchParams.get('season');
  }

  // content ID (エピソード識別子) を返す
  extractContentId(url) {
    return new URL(url).searchParams.get('content');
  }

  // エピソード番号を DOM から抽出 (1始まり)
  // ページタイトルや見出しの「第N話」テキストから読む
  extractEpisodeNumber(url, doc) {
    const sources = [
      doc.title,
      doc.querySelector('h1')?.textContent,
      doc.querySelector('h2')?.textContent,
      doc.querySelector('[class*="episode-number"]')?.textContent,
      doc.querySelector('[class*="episodeNumber"]')?.textContent,
    ];
    for (const src of sources) {
      if (!src) continue;
      const m = src.match(/第(\d+)話/);
      if (m) return parseInt(m[1], 10);
      // "1話" のような形式にも対応
      const m2 = src.match(/(\d+)話/);
      if (m2) return parseInt(m2[1], 10);
    }
    return null;
  }

  // DOM からエピソードリスト (contentId → episodeNumber) を構築
  // 作品ページでエピソードが描画されたあとに呼ぶ
  buildEpisodeMap(doc) {
    const links = doc.querySelectorAll('a[href*="content="]');
    const map = {};
    let num = 1;
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/[?&]content=([^&]+)/);
      if (m && !map[m[1]]) {
        map[m[1]] = num++;
      }
    }
    return map; // { contentId: episodeNumber }
  }

  // DOM から作品情報を取得 (作品ページ用)
  extractWorkInfo(doc) {
    // OGP タイトルからアニメタイトル部分のみ抜く ("タイトル (アニメ/YYYY年) | DMM TV..." 形式)
    const ogRaw = doc.querySelector('meta[property="og:title"]')?.content?.trim() || '';
    const titleMatch = ogRaw.match(/^(.+?)\s*[\(（(]/);
    const ogTitle = titleMatch ? titleMatch[1].trim() : ogRaw.split('|')[0].trim() || null;
    const h1 = doc.querySelector('h1')?.textContent?.trim() || null;
    const title = ogTitle || h1 || null;

    // content= リンク数を全話数とする (React 描画後に呼ぶこと)
    const episodeLinks = doc.querySelectorAll('a[href*="content="]');
    const totalEpisodes = episodeLinks.length > 0 ? episodeLinks.length : null;

    return { title, totalEpisodes };
  }
}

const seasonaAdapter = new DmmAnimeAdapter();
