(() => {
  const spanKey = ({ videoId, start, playedAt }) => `s:${videoId}:${start}:${playedAt}`;
  const videoFields = ({ videoId, title, duration, chapters, timestamps, plays, lastPlayed }) =>
    ({ videoId, title, duration, chapters, timestamps, plays, lastPlayed });

  function combine(rows, local, device) {
    const records = new Map(rows);
    for (const data of local.spans) {
      const key = spanKey(data);
      if (!records.has(key) || records.get(key).end < data.end) records.set(key, data);
    }
    for (const data of local.videos) {
      const key = `v:${device}:${data.videoId}`;
      const remote = records.get(key);
      records.set(key, remote ? {
        ...(remote.lastPlayed > data.lastPlayed ? remote : data),
        plays: Math.max(remote.plays, data.plays),
      } : data);
    }
    const videos = new Map();
    const spans = [];
    for (const [key, data] of records) {
      if (key.startsWith('s:')) {
        spans.push(data);
        continue;
      }
      const previous = videos.get(data.videoId);
      if (!previous) videos.set(data.videoId, data);
      else {
        const [latest, older] = data.lastPlayed >= previous.lastPlayed ? [data, previous] : [previous, data];
        videos.set(data.videoId, {
          ...latest,
          title: latest.title || older.title,
          duration: latest.duration || older.duration,
          chapters: latest.chapters.length ? latest.chapters : older.chapters,
          timestamps: latest.timestamps.length ? latest.timestamps : older.timestamps,
          plays: previous.plays + data.plays,
        });
      }
    }
    return { videos: Array.from(videos.values()), spans };
  }

  class HistorySync {
    constructor(endpoint, token, device) {
      this.endpoint = endpoint;
      this.token = token;
      this.device = device;
      this.rows = new Map();
      this.revision = null;
    }

    async request(path, method = 'GET', body) {
      const response = await fetch(new URL(path, this.endpoint), {
        method, cache: 'no-store', credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
      });
      if (!response.ok) {
        const error = new Error(`History service returned HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }

    state() {
      return this.request('/state');
    }

    async pull({ epoch, revision }) {
      if (epoch === this.epoch && revision === this.revision) return;
      const current = epoch === this.epoch;
      const rows = new Map(current ? this.rows : []);
      let cursor = [current ? this.revision ?? 0 : 0, Number.MAX_SAFE_INTEGER];
      do {
        const [from, id] = cursor;
        const page = await this.request(`/rows?epoch=${epoch}&from=${from}&until=${revision}&id=${id}`);
        for (const { key, data } of page.rows) rows.set(key, data);
        cursor = page.next;
      } while (cursor !== null);
      this.rows = rows;
      this.epoch = epoch;
      this.revision = revision;
    }

    async upload({ videos, spans }) {
      let batch = [];
      let size = 0;
      const encoder = new TextEncoder();
      const send = async () => {
        await this.request('/rows', 'POST',
          `{"device":"${this.device}","epoch":${this.epoch},"rows":[${batch.join(',')}]}`);
        batch = [];
        size = 0;
      };
      const append = async (type, data) => {
        const json = JSON.stringify({ type, data });
        const bytes = encoder.encode(json).byteLength;
        if (bytes > 1000000) throw new Error('A listening history record is too large to sync.');
        if (batch.length >= 40 || size + bytes > 1000000) await send();
        batch.push(json);
        size += bytes;
      };
      for (const { videoId, start, end, playedAt } of spans) {
        const data = { videoId, start, end, playedAt };
        const remote = this.rows.get(spanKey(data));
        if (!remote || remote.end < end) await append('span', data);
      }
      for (const video of videos) {
        const data = videoFields(video);
        const remote = this.rows.get(`v:${this.device}:${data.videoId}`);
        if (!remote || remote.lastPlayed < data.lastPlayed || remote.plays < data.plays
          || (remote.lastPlayed === data.lastPlayed && JSON.stringify(videoFields(remote)) !== JSON.stringify(data))) {
          await append('video', data);
        }
      }
      if (!batch.length) return false;
      await send();
      return true;
    }

    clear() {
      return this.request(`/rows?epoch=${this.epoch}`, 'DELETE');
    }
  }

  const api = { HistorySync, combine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ErAudioHistorySync = api;
})();
