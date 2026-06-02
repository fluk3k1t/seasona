// 解禁話数の計算ロジック
const SeasonaSchedule = {
  // 現在時刻時点で解禁されている話数を返す
  getUnlockedCount(anime, now = new Date()) {
    const start = new Date(anime.startDate);
    if (now < start) return 0;
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const elapsed = now - start;
    const count = Math.floor(elapsed / msPerWeek) + 1;
    return Math.min(count, anime.totalEpisodes);
  },

  // 次の解禁日時を返す (全話解禁済みなら null)
  getNextUnlockDate(anime, now = new Date()) {
    const unlocked = this.getUnlockedCount(anime, now);
    if (unlocked >= anime.totalEpisodes) return null;
    const start = new Date(anime.startDate);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    return new Date(start.getTime() + unlocked * msPerWeek);
  }
};
