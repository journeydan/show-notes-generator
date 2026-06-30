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

// ─── File-based episode API ───

const API_BASE = "/api/episodes";

export async function fetchEpisodeList() {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error(`Failed to fetch episodes: ${res.status}`);
  return res.json();
}

export async function fetchEpisode(slug) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch episode: ${res.status}`);
  return res.json();
}

export async function saveEpisode(data) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to save episode: ${res.status}`);
  return res.json();
}

export async function deleteEpisode(slug) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete episode: ${res.status}`);
  return res.json();
}
