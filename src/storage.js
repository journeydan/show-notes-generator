// ─── localStorage helpers (current session state, cache) ───
export const STORAGE_KEY = "show-notes-generator-v2";
export const CACHE_KEY = "show-notes-generator-cache";

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

export function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

export function getCacheKey(url, customPrompt) {
  return `${url}|${customPrompt || "default"}`;
}

// ─── localStorage episode storage (fallback & dual-save) ───
const EPISODES_LOCAL_KEY = "show-notes-local-episodes";

function nextEpisodeNumber() {
  try {
    const raw = localStorage.getItem(EPISODES_LOCAL_KEY);
    const episodes = raw ? JSON.parse(raw) : [];
    let max = 0;
    for (const ep of episodes) {
      const n = parseInt(ep.slug?.replace("episode-", "")) || 0;
      if (n > max) max = n;
    }
    return max + 1;
  } catch { return 1; }
}

function episodeSlug(num) {
  return `episode-${String(num).padStart(3, "0")}`;
}

function loadLocalEpisodes() {
  try {
    const raw = localStorage.getItem(EPISODES_LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveLocalEpisodes(episodes) {
  try {
    localStorage.setItem(EPISODES_LOCAL_KEY, JSON.stringify(episodes));
    return true;
  } catch { return false; }
}

// ─── File-based episode API (with localStorage fallback) ───

const API_BASE = "/api/episodes";

async function tryAPI(url, options) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    if (res.ok) return { ok: true, data: await res.json() };
    return { ok: false, error: `Status ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function fetchEpisodeList() {
  // Try API first
  const api = await tryAPI(API_BASE);
  if (api.ok) {
    // Merge with localStorage episodes (API takes precedence)
    const local = loadLocalEpisodes();
    if (local.length > 0) {
      const apiSlugs = new Set(api.data.map(e => e.slug));
      const merged = [...api.data, ...local.filter(e => !apiSlugs.has(e.slug))];
      return merged;
    }
    return api.data;
  }
  // Fall back to localStorage
  console.warn("API unavailable, using localStorage episodes");
  return loadLocalEpisodes();
}

export async function fetchEpisode(slug) {
  // Try API first
  const api = await tryAPI(`${API_BASE}/${encodeURIComponent(slug)}`);
  if (api.ok) return api.data;
  // Fall back to localStorage
  const local = loadLocalEpisodes();
  return local.find(e => e.slug === slug) || null;
}

export async function saveEpisode(data) {
  const now = new Date().toISOString();
  const slug = episodeSlug(data.number || nextEpisodeNumber());
  const episode = {
    slug,
    number: data.number || "",
    title: data.title || "",
    podcast: data.podcast || "",
    date: data.date || "",
    body: "",
    items: data.items || [],
    links: (data.items || []).map(i => i.url).filter(Boolean),
    _updated: now,
  };

  // Always save to localStorage first (dual-save)
  const episodes = loadLocalEpisodes();
  const idx = episodes.findIndex(e => e.slug === slug);
  if (idx >= 0) {
    episodes[idx] = { ...episodes[idx], ...episode };
  } else {
    episodes.unshift(episode);
  }
  saveLocalEpisodes(episodes.slice(0, 100));

  // Save to API (pass slug so server uses the same one)
  const api = await tryAPI(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, slug }),
  });
  if (api.ok) return api.data;

  console.warn("API unavailable, saved episode to localStorage only");
  return episode;
}

export async function deleteEpisode(slug) {
  // Try API
  const api = await tryAPI(`${API_BASE}/${encodeURIComponent(slug)}`, { method: "DELETE" });
  if (api.ok) return api.data;

  // Fallback: delete from localStorage
  console.warn("API unavailable, deleting from localStorage");
  const episodes = loadLocalEpisodes().filter(e => e.slug !== slug);
  saveLocalEpisodes(episodes);
  return { deleted: slug };
}
