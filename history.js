// Local listening history: spans of video positions that were actually played, stored in IndexedDB.
// Chapters, timestamps and heat maps are derived from the spans when they are read.
(() => {
  const DB_NAME = 'eraudio-history';
  const MIN_SPAN_SECONDS = 5;
  const MERGE_GAP_SECONDS = 2;
  const MERGE_WINDOW_MS = 10 * 60 * 1000;
  const FLUSH_INTERVAL_MS = 15000;
  const EXPORT_TYPE = 'eraudio-listening-history';
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

  const round = (value) => Math.round(value * 10) / 10;

  function overlap(span, start, end) {
    return Math.max(0, Math.min(span.end, end) - Math.max(span.start, start));
  }

  // Segments run from each marker to the next one, or to the end of the video.
  function buildSegments(markers, duration, spans = []) {
    const sorted = (markers || []).filter((marker) => Number.isFinite(marker.start) && marker.start >= 0)
      .slice().sort((a, b) => a.start - b.start);
    const spanEnd = spans.reduce((max, span) => Math.max(max, span.end), 0);
    const end = duration > 0 ? duration : spanEnd;
    if (!sorted.length) return end > 0 ? [{ start: 0, end, title: '' }] : [];
    const segments = sorted.map((marker, index) => ({
      start: marker.start,
      end: index + 1 < sorted.length ? sorted[index + 1].start : Math.max(end, marker.start + 1),
      title: marker.title || '',
    })).filter((segment) => segment.end > segment.start);
    if (sorted[0].start >= 1) segments.unshift({ start: 0, end: sorted[0].start, title: '', lead: true });
    return segments;
  }

  // A listen is a span that covers a meaningful part of the segment, so one long
  // listen through several segments counts once for each of them.
  function segmentStats(spans, segments) {
    return segments.map((segment) => {
      const length = segment.end - segment.start;
      const needed = Math.min(MIN_SPAN_SECONDS, length / 2);
      let seconds = 0;
      let listens = 0;
      spans.forEach((span) => {
        const covered = overlap(span, segment.start, segment.end);
        seconds += covered;
        if (covered > 0 && covered >= needed) listens += 1;
      });
      return { listens, seconds, coverage: length > 0 ? seconds / length : 0 };
    });
  }

  function heatBuckets(spans, duration, count) {
    const buckets = new Array(count).fill(0);
    if (!(duration > 0)) return buckets;
    const size = duration / count;
    spans.forEach((span) => {
      const first = Math.max(0, Math.floor(span.start / size));
      const last = Math.min(count - 1, Math.floor((span.end - 1e-9) / size));
      for (let i = first; i <= last; i += 1) buckets[i] += overlap(span, i * size, (i + 1) * size) / size;
    });
    return buckets;
  }

  // 0 is cold (no listening), 1 is the hottest part of the video.
  function heatColor(level) {
    if (!(level > 0)) return 'transparent';
    const clamped = Math.min(1, level);
    return `hsl(${Math.round(210 * (1 - clamped))} 90% ${Math.round(30 + (clamped * 20))}%)`;
  }

  function heatGradient(buckets) {
    const max = Math.max(...buckets, 0);
    if (!(max > 0)) return 'none';
    const size = 100 / buckets.length;
    const stops = buckets.map((value, i) => {
      const color = heatColor(value / max);
      return `${color} ${(i * size).toFixed(3)}% ${((i + 1) * size).toFixed(3)}%`;
    });
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }

  function normalizeMarkers(markers) {
    if (!Array.isArray(markers)) return undefined;
    return markers.filter((marker) => marker && Number.isFinite(marker.start) && marker.start >= 0)
      .map((marker) => ({ start: round(marker.start), title: String(marker.title || '').slice(0, 200) }));
  }

  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const transactionDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });

  class ListeningHistory {
    constructor(dbName = DB_NAME) {
      this.dbName = dbName;
      this.db = null;
      this.available = false;
      this.persisted = false;
      this.queue = Promise.resolve();
      this.current = null;
      this.last = null;
      this.sessionVideo = null;
      this.sessionCounted = false;
      this.onChange = null;
    }

    async init() {
      try {
        if (!globalThis.indexedDB) throw new Error('IndexedDB unavailable');
        this.db = await new Promise((resolve, reject) => {
          const open = indexedDB.open(this.dbName, 2);
          open.onupgradeneeded = (event) => {
            const db = open.result;
            if (event.oldVersion === 0) {
              db.createObjectStore('videos', { keyPath: 'videoId' });
              db.createObjectStore('spans', { keyPath: 'id', autoIncrement: true })
                .createIndex('videoId', 'videoId');
            }
            db.createObjectStore('settings');
          };
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
          open.onblocked = () => reject(new Error('Database blocked'));
        });
        this.db.onversionchange = () => {
          this.db.close();
          this.available = false;
          this.onChange?.(null);
        };
        this.available = true;
        try {
          this.persisted = Boolean(await navigator.storage?.persist?.());
        } catch {
          this.persisted = false;
        }
      } catch (error) {
        this.available = false;
        this.error = error;
      }
      return this.available;
    }

    enqueue(operation) {
      const run = this.queue.then(operation);
      this.queue = run.catch(() => {});
      return run;
    }

    getSpans(videoId) {
      return this.enqueue(async () => {
        if (!this.available) return [];
        return request(this.db.transaction('spans').objectStore('spans').index('videoId').getAll(videoId));
      });
    }

    getAll() {
      return this.enqueue(async () => {
        if (!this.available) return { videos: [], spans: [] };
        const tx = this.db.transaction(['videos', 'spans']);
        const [videos, spans] = await Promise.all([
          request(tx.objectStore('videos').getAll()),
          request(tx.objectStore('spans').getAll()),
        ]);
        return { videos, spans };
      });
    }

    async getDeviceId() {
      const candidate = crypto.randomUUID();
      const tx = this.db.transaction('settings', 'readwrite');
      const done = transactionDone(tx);
      const store = tx.objectStore('settings');
      const existing = await request(store.get('deviceId'));
      if (!existing) store.put(candidate, 'deviceId');
      await done;
      return existing || candidate;
    }

    async writeVideo(meta, { incrementPlays = false, onlyIfExists = false } = {}) {
      const tx = this.db.transaction('videos', 'readwrite');
      const store = tx.objectStore('videos');
      const existing = await request(store.get(meta.videoId));
      if (!existing && onlyIfExists) return;
      const chapters = normalizeMarkers(meta.chapters);
      const timestamps = normalizeMarkers(meta.timestamps);
      store.put({
        videoId: meta.videoId,
        title: String(meta.title || existing?.title || '').slice(0, 300),
        duration: meta.duration > 0 ? round(meta.duration) : (existing?.duration || 0),
        chapters: chapters ?? existing?.chapters ?? [],
        timestamps: timestamps ?? existing?.timestamps ?? [],
        plays: (existing?.plays || 0) + (incrementPlays ? 1 : 0),
        lastPlayed: Date.now(),
      });
      await transactionDone(tx);
    }

    updateVideoMeta(meta) {
      return this.enqueue(async () => {
        if (this.available) await this.writeVideo(meta, { onlyIfExists: true });
      });
    }

    // Writes or extends a span. The span object is shared, so queued writes stay consistent.
    flushSpan(span) {
      if (!this.available || span.end - span.start < MIN_SPAN_SECONDS) return Promise.resolve();
      return this.enqueue(async () => {
        const record = {
          videoId: span.videoId, start: round(span.start), end: round(span.end), playedAt: span.playedAt,
        };
        const tx = this.db.transaction('spans', 'readwrite');
        const store = tx.objectStore('spans');
        if (span.id === undefined) span.id = await request(store.add(record));
        else store.put({ ...record, id: span.id });
        await transactionDone(tx);
        const countPlay = !this.sessionCounted && this.sessionVideo === span.videoId;
        if (countPlay) this.sessionCounted = true;
        const meta = span.getMeta?.();
        if (meta || countPlay) {
          await this.writeVideo(meta || { videoId: span.videoId }, { incrementPlays: countPlay });
        }
        this.onChange?.(span.videoId);
      }).catch((error) => {
        this.available = false;
        this.error = error;
        this.onChange?.(span.videoId);
      });
    }

    // Called repeatedly while a video is loaded. Position is in video seconds, so speed changes need no handling.
    update({ videoId, position, playing, rate = 1, getMeta, now = Date.now() }) {
      if (!this.available) return;
      if (!playing || !videoId || !Number.isFinite(position)) {
        this.close(now);
        return;
      }
      const span = this.current;
      if (span && span.videoId === videoId) {
        const elapsed = Math.max(0, (now - span.lastTick) / 1000);
        const expected = span.end + (elapsed * rate);
        if (Math.abs(position - expected) > Math.max(1.5, (elapsed * rate * 0.5) + 1)) {
          this.close(now);
          this.start(videoId, position, getMeta, now);
          return;
        }
        span.end = Math.max(span.end, position);
        span.lastTick = now;
        span.getMeta = getMeta;
        if (now - span.lastFlush >= FLUSH_INTERVAL_MS) {
          span.lastFlush = now;
          this.flushSpan(span);
        }
        return;
      }
      this.close(now);
      this.start(videoId, position, getMeta, now);
    }

    start(videoId, position, getMeta, now) {
      if (videoId !== this.sessionVideo) {
        this.sessionVideo = videoId;
        this.sessionCounted = false;
      }
      const last = this.last;
      this.last = null;
      // Resuming right where the previous span ended (pause/resume, buffering) continues that span.
      if (last && last.videoId === videoId && now - last.endedAt <= MERGE_WINDOW_MS
        && position >= last.end - MERGE_GAP_SECONDS && position <= last.end + MERGE_GAP_SECONDS) {
        last.end = Math.max(position, last.end);
        last.lastTick = now;
        last.lastFlush = now;
        last.getMeta = getMeta;
        this.current = last;
        return;
      }
      this.current = {
        videoId, start: position, end: position, playedAt: now, lastTick: now, lastFlush: now, getMeta,
      };
    }

    close(now = Date.now()) {
      const span = this.current;
      if (!span) return;
      this.current = null;
      span.endedAt = now;
      this.last = span;
      this.flushSpan(span);
    }

    flushCurrent() {
      if (this.current) {
        this.current.lastFlush = Date.now();
        this.flushSpan(this.current);
      }
    }

    // Ends the playback session (video finished or stopped) so replaying it counts as a new play.
    endSession() {
      this.close();
      this.last = null;
      this.sessionVideo = null;
      this.sessionCounted = false;
    }

    clear() {
      this.current = null;
      this.last = null;
      this.sessionCounted = false;
      return this.enqueue(async () => {
        if (!this.available) return;
        const tx = this.db.transaction(['videos', 'spans'], 'readwrite');
        tx.objectStore('videos').clear();
        tx.objectStore('spans').clear();
        await transactionDone(tx);
        this.onChange?.(null);
      });
    }

    static exportSnapshot({ videos, spans }) {
      return {
        app: 'ErAudio',
        type: EXPORT_TYPE,
        version: 1,
        exportedAt: new Date().toISOString(),
        videos,
        spans: spans.map(({ videoId, start, end, playedAt }) => ({ videoId, start, end, playedAt })),
      };
    }

    async exportData() {
      return ListeningHistory.exportSnapshot(await this.getAll());
    }

    // Merges an export into the existing history, skipping spans that are already stored.
    async importData(data) {
      if (!data || data.type !== EXPORT_TYPE || data.version !== 1
        || !Array.isArray(data.videos) || !Array.isArray(data.spans)) {
        throw new Error('This file is not an ErAudio listening history export.');
      }
      const spans = data.spans.map((span) => {
        if (!span || !VIDEO_ID.test(span.videoId) || !Number.isFinite(span.start) || !Number.isFinite(span.end)
          || span.start < 0 || span.end <= span.start || !Number.isFinite(span.playedAt)) {
          throw new Error('The listening history file contains invalid entries. Nothing was imported.');
        }
        return { videoId: span.videoId, start: round(span.start), end: round(span.end), playedAt: span.playedAt };
      });
      const videos = data.videos.map((video) => {
        if (!video || !VIDEO_ID.test(video.videoId)) {
          throw new Error('The listening history file contains invalid entries. Nothing was imported.');
        }
        return {
          videoId: video.videoId,
          title: String(video.title || '').slice(0, 300),
          duration: Number.isFinite(video.duration) && video.duration > 0 ? round(video.duration) : 0,
          chapters: normalizeMarkers(video.chapters) || [],
          timestamps: normalizeMarkers(video.timestamps) || [],
          plays: Number.isInteger(video.plays) && video.plays > 0 ? video.plays : 0,
          lastPlayed: Number.isFinite(video.lastPlayed) ? video.lastPlayed : 0,
        };
      });
      return this.enqueue(async () => {
        if (!this.available) throw new Error('Listening history storage is unavailable.');
        const tx = this.db.transaction(['videos', 'spans'], 'readwrite');
        const spanStore = tx.objectStore('spans');
        const videoStore = tx.objectStore('videos');
        const keyOf = (span) => `${span.videoId}|${span.start}|${span.end}|${span.playedAt}`;
        const known = new Set((await request(spanStore.getAll())).map(keyOf));
        let added = 0;
        spans.forEach((span) => {
          if (known.has(keyOf(span))) return;
          known.add(keyOf(span));
          spanStore.add(span);
          added += 1;
        });
        for (const video of videos) {
          const existing = await request(videoStore.get(video.videoId));
          videoStore.put(existing ? {
            ...video,
            title: video.title || existing.title,
            duration: video.duration || existing.duration,
            chapters: video.chapters.length ? video.chapters : existing.chapters,
            timestamps: video.timestamps.length ? video.timestamps : existing.timestamps,
            plays: Math.max(video.plays, existing.plays || 0),
            lastPlayed: Math.max(video.lastPlayed, existing.lastPlayed || 0),
          } : video);
        }
        await transactionDone(tx);
        this.onChange?.(null);
        return { spans: added, videos: videos.length };
      });
    }
  }

  const api = {
    ListeningHistory,
    MIN_SPAN_SECONDS,
    buildSegments,
    segmentStats,
    heatBuckets,
    heatColor,
    heatGradient,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ErAudioHistory = api;
})();
