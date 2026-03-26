// ── In-memory cache with TTL ──────────────────────────────────
const store = {}

export const cache = {
  set(key, data, ttlSeconds = 30) {
    store[key] = {
      data,
      expires: Date.now() + ttlSeconds * 1000,
    }
  },

  get(key) {
    const entry = store[key]
    if (!entry) return null
    if (Date.now() > entry.expires) {
      delete store[key]
      return null
    }
    return entry.data
  },

  invalidate(pattern) {
    // pattern can be exact key or prefix with *
    Object.keys(store).forEach(key => {
      if (pattern.endsWith('*')) {
        if (key.startsWith(pattern.slice(0, -1))) delete store[key]
      } else {
        if (key === pattern) delete store[key]
      }
    })
  },

  invalidateAll() {
    Object.keys(store).forEach(k => delete store[k])
  },

  // Cached fetch — returns cached or fetches fresh
  async fetch(key, fetchFn, ttlSeconds = 30) {
    const cached = this.get(key)
    if (cached !== null) return cached
    const data = await fetchFn()
    this.set(key, data, ttlSeconds)
    return data
  },
}