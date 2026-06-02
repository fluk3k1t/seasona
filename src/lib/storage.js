// chrome.storage.sync の CRUD ラッパー
const SeasonaStorage = {
  async getAll() {
    const result = await chrome.storage.sync.get(null);
    return Object.entries(result)
      .filter(([k]) => k.startsWith('anime_'))
      .map(([, v]) => v);
  },

  async getByWorkId(siteId, workId) {
    const all = await this.getAll();
    return all.find(a => a.siteId === siteId && a.workId === workId) || null;
  },

  async save(anime) {
    await chrome.storage.sync.set({ [`anime_${anime.id}`]: anime });
    return anime;
  },

  async remove(id) {
    await chrome.storage.sync.remove(`anime_${id}`);
  }
};
