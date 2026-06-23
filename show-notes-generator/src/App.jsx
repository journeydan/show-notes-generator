import { useState, useRef, useEffect, useCallback } from "react";

/* ─── Constants ─── */
const ACCENT = "#E8FF47";
const BG = "#0D0D0D";
const CARD = "#161616";
const BORDER = "#2A2A2A";
const MUTED = "#666";
const TEXT = "#F0F0F0";

const STORAGE_KEY = "show-notes-generator-v2";
const CACHE_KEY = "show-notes-generator-cache";
const BATCH_SIZE = 3;
const EPISODE_KEY = "show-notes-generator-episodes";

/* ─── Utilities ─── */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

function loadEpisodes() {
  try {
    const raw = localStorage.getItem(EPISODE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function upsertEpisode(episode) {
  try {
    const episodes = loadEpisodes();
    const idx = episodes.findIndex((e) => e.id === episode.id);
    if (idx >= 0) { episodes[idx] = episode; } else { episodes.unshift(episode); }
    localStorage.setItem(EPISODE_KEY, JSON.stringify(episodes.slice(0, 100)));
  } catch {}
}

function getCacheKey(url, customPrompt) {
  return `${url}|${customPrompt || "default"}`;
}

async function asyncPool(concurrency, items, fn) {
  const results = [];
  const queue = [...items];
  const inFlight = new Set();

  const next = () => {
    if (!queue.length) return;
    const idx = results.length;
    const item = queue.shift();
    const promise = fn(item, idx).then((r) => {
      results[idx] = r;
      inFlight.delete(promise);
    });
    results.push(undefined);
    inFlight.add(promise);
    return promise;
  };

  // Start initial batch
  const runners = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    runners.push(next());
  }
  await Promise.all(runners);

  // Process remaining
  while (inFlight.size > 0) {
    const done = await Promise.race(inFlight);
    const p = next();
    if (p) { const _ = p; } // fire-and-forget into the race set
  }

  return results;
}

function parseLinks(text) {
  return text.split(/[\n,]+/).map((l) => l.trim()).filter((l) => l.match(/^https?:\/\//));
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

/* ─── AI: Summarize a single link ─── */
async function summarizeLink(url, podcastName, episodeTitle, apiKey, customPrompt) {
  const systemPrompt = customPrompt ||
    `You are a research assistant for a podcast called "${podcastName || 'the podcast'}".

Your task: Given this URL, provide a concise show notes entry.

URL: ${url}

Return a JSON object with exactly these fields:
{
  "title": "Article/resource title (concise, descriptive)",
  "summary": "2-3 sentence summary of the key points, written for podcast listeners. What will they get from reading/watching this? Be specific and informative.",
  "tags": ["tag1", "tag2"]
}

Only return valid JSON, no markdown, no preamble.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: systemPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const clean = text.replace(/```json|```/g, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { title: extractDomain(url), summary: "Could not retrieve a summary. Visit the link directly.", tags: [] };
  try { return JSON.parse(jsonMatch[0]); }
  catch { return { title: extractDomain(url), summary: "Could not retrieve a summary. Visit the link directly.", tags: [] }; }
}

/* ─── AI: Suggest cross-cutting tags ─── */
async function suggestCrossTags(items, apiKey) {
  const summaries = items
    .filter((i) => i.status === "done")
    .map((i, idx) => `[${idx + 1}] "${i.title}": ${i.summary}`)
    .join("\n\n");

  const prompt = `Below is a list of articles/resources for a podcast episode's show notes. Based on ALL of them together, suggest 3-8 broad topic tags that describe the episode as a whole.

${summaries}

Return ONLY a JSON array of tag strings, no markdown, no preamble. Example: ["AI", "Technology", "Startups"]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) return [];
  const data = await response.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); } catch { return []; }
}

/* ─── RSS Import ─── */
async function fetchRSSTitles(url) {
  // Use a free CORS proxy + fetch the RSS XML
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const resp = await fetch(proxyUrl);
  if (!resp.ok) throw new Error(`Could not fetch RSS feed (${resp.status})`);

  const xml = await resp.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  // Try <link> elements (RSS 2.0 / Atom)
  const links = [];
  const items = doc.querySelectorAll("item, entry");
  items.forEach((item) => {
    const linkEl = item.querySelector("link");
    if (!linkEl) return;
    let href = linkEl.textContent?.trim() || linkEl.getAttribute("href");
    // Atom feeds often have href as attribute
    if (!href) href = linkEl.getAttribute("href");
    if (href && href.match(/^https?:\/\//)) links.push(href);
  });

  return links;
}

/* ─── Format functions ─── */
function formatMarkdown(items, podcastName, episodeTitle, episodeNumber, customDate, sponsorText) {
  const date = customDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let out = "";
  if (episodeTitle) out += `# ${episodeNumber ? `Ep. ${episodeNumber}: ` : ""}${episodeTitle}\n`;
  if (podcastName) out += `**${podcastName}** · ${date}\n`;
  out += "\n---\n\n## Links & Resources\n\n";
  items.filter((i) => i.status === "done").forEach((item, i) => {
    out += `### ${i + 1}. ${item.title}\n`;
    out += `🔗 ${item.url}\n\n`;
    out += `${item.summary}\n\n`;
    if (item.tags?.length) out += `*Tags: ${item.tags.join(", ")}*\n`;
    out += "\n";
  });
  if (sponsorText) {
    out += "---\n\n";
    out += `${sponsorText}\n`;
  }
  return out.trim();
}

function formatNewsletter(items, podcastName, episodeTitle, episodeNumber, customDate, sponsorText) {
  const date = customDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let out = "";
  if (episodeTitle) {
    out += `${episodeNumber ? `Episode ${episodeNumber}: ` : ""}${episodeTitle}\n`;
    out += "=".repeat(60) + "\n\n";
  }
  out += `This week on ${podcastName || "the podcast"} (${date}), here's what we're covering:\n\n`;
  items.filter((i) => i.status === "done").forEach((item, i) => {
    out += `${i + 1}. ${item.title.toUpperCase()}\n`;
    out += `${item.summary}\n`;
    out += `Read more: ${item.url}\n\n`;
  });
  if (sponsorText) {
    out += "—\n\n";
    out += `${sponsorText}\n`;
  }
  return out.trim();
}

function formatHTML(items, podcastName, episodeTitle, episodeNumber, customDate, sponsorText) {
  const date = customDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let out = "<!DOCTYPE html>\n<html><head><meta charset='utf-8'></head><body style='font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px;color:#333;line-height:1.6;'>\n";
  if (episodeTitle) out += `<h1>${episodeNumber ? `Ep. ${episodeNumber}: ` : ""}${escHTML(episodeTitle)}</h1>\n`;
  if (podcastName) out += `<p style="color:#888;font-size:14px;"><strong>${escHTML(podcastName)}</strong> · ${date}</p>\n`;
  out += "<hr>\n<h2>Links & Resources</h2>\n";
  items.filter((i) => i.status === "done").forEach((item, i) => {
    out += `<h3>${i + 1}. ${escHTML(item.title)}</h3>\n`;
    out += `<p><a href="${escHTML(item.url)}">${escHTML(item.url)}</a></p>\n`;
    out += `<p>${escHTML(item.summary)}</p>\n`;
    if (item.tags?.length) out += `<p style="font-size:12px;color:#888;">Tags: ${item.tags.map((t) => escHTML(t)).join(", ")}</p>\n`;
  });
  if (sponsorText) { out += "<hr>\n"; out += `<p>${escHTML(sponsorText)}</p>\n`; }
  out += "</body></html>";
  return out;
}

function formatSocialThread(items, podcastName, episodeTitle, episodeNumber, customDate, sponsorText) {
  const date = customDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const done = items.filter((i) => i.status === "done");
  let out = `🧵 ${podcastName || "the podcast"} — ${episodeTitle || date}\n\n`;
  done.forEach((item, i) => {
    out += `${i + 1}/${done.length} 📄 ${item.title}\n`;
    out += `${item.summary}\n`;
    out += `${item.url}\n\n`;
  });
  if (sponsorText) out += `📢 ${sponsorText}\n\n`;
  out += "🎧 Listen to the full episode!";
  return out;
}

function escHTML(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ─── Styles ─── */
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: ${BG};
    color: ${TEXT};
    font-family: 'Syne', sans-serif;
    min-height: 100vh;
  }

  .app {
    max-width: 820px;
    margin: 0 auto;
    padding: 48px 24px 80px;
  }

  .header { margin-bottom: 48px; }

  .eyebrow {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: ${ACCENT};
    margin-bottom: 12px;
  }

  h1 {
    font-size: clamp(32px, 6vw, 52px);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.03em;
  }

  h1 span { color: ${ACCENT}; }

  .subtitle {
    margin-top: 14px;
    color: ${MUTED};
    font-size: 15px;
    font-weight: 400;
    line-height: 1.6;
    max-width: 500px;
  }

  .api-key-banner {
    background: #1a1200;
    border: 1px solid #E8FF4733;
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 28px;
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    color: #E8FF4799;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .api-key-banner input {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 1px solid #E8FF4733;
    color: ${TEXT};
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    padding: 4px 0;
    outline: none;
  }

  .config-row {
    display: flex;
    gap: 12px;
    margin-bottom: 28px;
    flex-wrap: wrap;
  }

  .config-field { flex: 1; min-width: 180px; }

  .config-field label {
    display: block;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: ${MUTED};
    margin-bottom: 6px;
  }

  .config-field input {
    width: 100%;
    background: ${CARD};
    border: 1px solid ${BORDER};
    color: ${TEXT};
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    padding: 10px 14px;
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s;
  }

  .config-field input:focus { border-color: ${ACCENT}; }

  .link-input-area {
    background: ${CARD};
    border: 1px solid ${BORDER};
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 16px;
  }

  .link-input-area label {
    display: block;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: ${MUTED};
    margin-bottom: 10px;
  }

  textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: ${TEXT};
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    line-height: 1.8;
    resize: vertical;
    min-height: 140px;
    outline: none;
  }

  textarea::placeholder { color: #3A3A3A; }

  .inline-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-bottom: 40px;
  }

  .btn-primary {
    background: ${ACCENT};
    color: #000;
    border: none;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 14px;
    padding: 13px 28px;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-primary:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-secondary {
    background: transparent;
    color: ${MUTED};
    border: 1px solid ${BORDER};
    font-family: 'Syne', sans-serif;
    font-weight: 600;
    font-size: 14px;
    padding: 13px 20px;
    border-radius: 6px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .btn-secondary:hover { color: ${TEXT}; border-color: #444; }

  .btn-ghost {
    background: transparent;
    color: ${MUTED};
    border: none;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .btn-ghost:hover { color: ${TEXT}; background: #1A1A1A; }

  .btn-small {
    background: transparent;
    color: ${MUTED};
    border: 1px solid ${BORDER};
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.15s;
    line-height: 1;
  }

  .btn-small:hover { color: ${TEXT}; border-color: #555; }

  .btn-retry {
    background: transparent;
    border: 1px solid #FF6B6B44;
    color: #FF6B6B;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    margin-top: 8px;
  }

  .btn-retry:hover { background: #FF6B6B11; border-color: #FF6B6B88; }

  .btn-danger {
    background: transparent;
    border: 1px solid #FF6B6B33;
    color: #FF6B6B99;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.15s;
  }

  .btn-danger:hover { color: #FF6B6B; border-color: #FF6B6B88; }

  .section-label {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: ${MUTED};
    margin-bottom: 20px;
  }

  .notes-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .copy-btn {
    background: transparent;
    color: ${ACCENT};
    border: 1px solid ${ACCENT}44;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 8px 16px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .copy-btn:hover { background: ${ACCENT}15; }

  .item-card {
    border: 1px solid ${BORDER};
    border-radius: 10px;
    padding: 22px 24px;
    margin-bottom: 14px;
    background: ${CARD};
    transition: border-color 0.2s;
    animation: fadeSlide 0.3s ease forwards;
    position: relative;
  }

  @keyframes fadeSlide {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .item-card:hover { border-color: #333; }
  .item-card.loading { border-color: ${ACCENT}33; }
  .item-card.editing { border-color: ${ACCENT}; }

  .card-actions {
    position: absolute;
    top: 12px;
    right: 14px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .item-card:hover .card-actions { opacity: 1; }

  a.item-url {
    display: block;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    color: ${ACCENT};
    margin-bottom: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
    text-decoration: none;
    transition: opacity 0.15s;
    padding-right: 80px;
  }

  a.item-url:hover { opacity: 1; text-decoration: underline; }

  .item-title {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.015em;
    margin-bottom: 8px;
    line-height: 1.3;
  }

  .item-summary {
    font-size: 14px;
    line-height: 1.75;
    color: #AAAAAA;
  }

  .item-loading {
    display: flex;
    align-items: center;
    gap: 10px;
    color: ${MUTED};
    font-family: 'DM Mono', monospace;
    font-size: 12px;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid ${BORDER};
    border-top-color: ${ACCENT};
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .item-error {
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    color: #FF6B6B;
  }

  .output-box {
    background: ${CARD};
    border: 1px solid ${BORDER};
    border-radius: 10px;
    padding: 28px;
    margin-top: 20px;
  }

  .output-text {
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    line-height: 1.85;
    color: #CCCCCC;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .output-html-preview {
    font-size: 14px;
    line-height: 1.7;
    color: ${TEXT};
  }

  .output-html-preview a { color: ${ACCENT}; }
  .output-html-preview h1 { font-size: 24px; margin-bottom: 12px; }
  .output-html-preview h2 { font-size: 20px; margin-bottom: 10px; color: ${ACCENT}; }
  .output-html-preview h3 { font-size: 17px; margin-bottom: 8px; }
  .output-html-preview p { margin-bottom: 10px; }
  .output-html-preview hr { border: none; border-top: 1px solid ${BORDER}; margin: 20px 0; }

  .format-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .tab {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 7px 14px;
    border-radius: 5px;
    border: 1px solid ${BORDER};
    background: transparent;
    color: ${MUTED};
    cursor: pointer;
    transition: all 0.15s;
  }

  .tab.active {
    background: ${ACCENT}20;
    border-color: ${ACCENT}55;
    color: ${ACCENT};
  }

  .progress-bar {
    height: 2px;
    background: ${BORDER};
    border-radius: 2px;
    margin-bottom: 28px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: ${ACCENT};
    border-radius: 2px;
    transition: width 0.4s ease;
  }

  .ep-info {
    background: ${ACCENT}0D;
    border: 1px solid ${ACCENT}22;
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 24px;
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    color: ${ACCENT}AA;
    line-height: 1.6;
  }

  .tag {
    display: inline-block;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 4px;
    background: #1E1E1E;
    color: ${MUTED};
    margin-right: 6px;
    margin-bottom: 10px;
  }

  .tag-edit-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid ${BORDER};
    color: ${TEXT};
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    padding: 4px 0;
    outline: none;
    width: 100%;
    margin-top: 8px;
  }

  .edit-field {
    width: 100%;
    background: #1A1A1A;
    border: 1px solid ${BORDER};
    color: ${TEXT};
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    padding: 8px 12px;
    border-radius: 5px;
    outline: none;
    margin-bottom: 8px;
    transition: border-color 0.15s;
  }

  .edit-field:focus { border-color: ${ACCENT}; }

  .edit-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .collapsible-toggle {
    background: transparent;
    border: none;
    color: ${MUTED};
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    cursor: pointer;
    padding: 6px 0;
    transition: color 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .collapsible-toggle:hover { color: ${TEXT}; }

  .collapsible-content {
    margin-top: 10px;
    animation: fadeSlide 0.2s ease forwards;
  }

  .duplicate-warning {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    color: #FFA500;
    margin-top: 4px;
  }

  .inline-tag {
    display: inline-block;
    background: #1E1E1E;
    border: 1px solid ${BORDER};
    color: ${MUTED};
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    margin-right: 4px;
    margin-bottom: 4px;
  }

  .inline-tag.clickable { cursor: pointer; }
  .inline-tag.clickable:hover { border-color: #FF6B6B88; color: #FF6B6B; }

  .suggested-tags-area {
    margin-top: 12px;
    padding: 12px 16px;
    background: #1A1A1A;
    border: 1px solid ${BORDER};
    border-radius: 8px;
    animation: fadeSlide 0.3s ease forwards;
  }

  .suggested-tags-area .label {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    color: ${MUTED};
    margin-bottom: 8px;
    letter-spacing: 0.1em;
  }

  .duplicate-badge {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    color: #FFA500;
  }

  .sponsor-field {
    margin-top: 12px;
    animation: fadeSlide 0.2s ease forwards;
  }

  .sponsor-field textarea {
    min-height: 60px;
    font-size: 12px;
  }
`;

const ENV_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

/* ─── Component ─── */
export default function ShowNotesGenerator() {
  const [apiKey, setApiKey] = useState(ENV_API_KEY);
  const [podcastName, setPodcastName] = useState("Old's Cool");
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [episodeNumber, setEpisodeNumber] = useState("");
  const [episodeDate, setEpisodeDate] = useState("");
  const [linksText, setLinksText] = useState("");
  const [items, setItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState("cards");
  const [copied, setCopied] = useState(false);
  const [outputFormat, setOutputFormat] = useState("markdown");
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [rssUrl, setRssUrl] = useState("");
  const [showRssImport, setShowRssImport] = useState(false);
  const [importingRss, setImportingRss] = useState(false);
  const [showSponsor, setShowSponsor] = useState(false);
  const [sponsorText, setSponsorText] = useState("");
  const [suggestingTags, setSuggestingTags] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState([]);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);
    const [editingIndex, setEditingIndex] = useState(-1);
    const [editTitle, setEditTitle] = useState("");
    const [editSummary, setEditSummary] = useState("");
    const [editTags, setEditTags] = useState("");
  const [episodes, setEpisodes] = useState(() => loadEpisodes());
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [currentEpisodeId, setCurrentEpisodeId] = useState(null);

  const itemsRef = useRef([]);
  const initialized = useRef(false);

  /* ─── localStorage persistence ─── */
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const saved = loadState();
    if (saved) {
      setPodcastName(saved.podcastName || "Old's Cool");
      setEpisodeTitle(saved.episodeTitle || "");
      setEpisodeNumber(saved.episodeNumber || "");
      setEpisodeDate(saved.episodeDate || "");
      setShowSponsor(saved.showSponsor || false);
      setSponsorText(saved.sponsorText || "");
      setCustomPrompt(saved.customPrompt || "");
      setShowCustomPrompt(saved.showCustomPrompt || false);
      if (saved.items?.length) {
        setItems(saved.items);
        itemsRef.current = saved.items;
      }
    }
  }, []);

  useEffect(() => {
    if (!initialized.current) return;
    saveState({ podcastName, episodeTitle, episodeNumber, episodeDate, showSponsor, sponsorText, customPrompt, showCustomPrompt, items });
  }, [podcastName, episodeTitle, episodeNumber, episodeDate, showSponsor, sponsorText, customPrompt, showCustomPrompt, items]);

  /* ─── Derived ─── */
  const doneItems = items.filter((i) => i.status === "done");
  const progress = items.length ? Math.round((items.filter((i) => i.status !== "loading").length / items.length) * 100) : 0;
  const links = parseLinks(linksText);
  const existingUrls = new Set(items.map((i) => i.url));
  const duplicateCount = links.filter((u) => existingUrls.has(u)).length;
  const canGenerate = apiKey && links.length > 0 && !isRunning;

  /* ─── Handlers ─── */

  const handleGenerate = async () => {
    if (!links.length || !apiKey) return;
    const newLinks = links.filter((url) => !existingUrls.has(url));
    if (!newLinks.length) return;
    const newItems = newLinks.map((url) => ({ url, status: "loading", title: "", summary: "", tags: [] }));
    const combined = [...itemsRef.current, ...newItems];
    setItems(combined);
    itemsRef.current = combined;
    setIsRunning(true);
    setActiveTab("cards");
    setLinksText("");

    const cache = loadCache();
    const toFetch = [];

    for (const url of newLinks) {
      const key = getCacheKey(url, customPrompt);
      if (cache[key]) {
        const result = cache[key];
        const updated = itemsRef.current.map((item) =>
          item.url === url && item.status === "loading" ? { ...item, status: "done", ...result } : item
        );
        itemsRef.current = updated;
        setItems([...updated]);
      } else {
        toFetch.push(url);
      }
    }

    // Process uncached links in batches
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (url) => {
          try {
            const result = await summarizeLink(url, podcastName, episodeTitle, apiKey, customPrompt);
            const key = getCacheKey(url, customPrompt);
            cache[key] = result;
            saveCache(cache);
            const updated = itemsRef.current.map((item) =>
              item.url === url && item.status === "loading" ? { ...item, status: "done", ...result } : item
            );
            itemsRef.current = updated;
            setItems([...updated]);
          } catch (e) {
            const updated = itemsRef.current.map((item) =>
              item.url === url && item.status === "loading"
                ? { ...item, status: "error", title: "Could not summarize", summary: e.message }
                : item
            );
            itemsRef.current = updated;
            setItems([...updated]);
          }
        })
      );
    }

    setIsRunning(false);

    // Auto-save/update episode draft after generation
    const finalItems = itemsRef.current;
    if (finalItems.some((i) => i.status === "done")) {
      setEpisodes((prev) => {
        const id = currentEpisodeId || Date.now();
        const existing = prev.find((e) => e.id === id);
        const episode = {
          id,
          status: existing?.status || "draft",
          podcastName,
          episodeTitle,
          episodeNumber,
          episodeDate,
          items: finalItems,
          pendingLinks: "",
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        upsertEpisode(episode);
        if (!currentEpisodeId) setCurrentEpisodeId(id);
        return loadEpisodes();
      });
    }
  };

  const handleClear = () => {
    setItems([]);
    setLinksText("");
    itemsRef.current = [];
    setSuggestedTags([]);
    setCurrentEpisodeId(null);
  };

  const handleSaveDraft = () => {
    const id = currentEpisodeId || Date.now();
    const existing = episodes.find((e) => e.id === id);
    const episode = {
      id,
      status: existing?.status === "done" ? "done" : "draft",
      podcastName,
      episodeTitle,
      episodeNumber,
      episodeDate,
      items: itemsRef.current,
      pendingLinks: linksText,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertEpisode(episode);
    setCurrentEpisodeId(id);
    setEpisodes(loadEpisodes());
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ─── Edit card handlers ─── */
  const handleStartEdit = (index) => {
    setEditingIndex(index);
    setEditTitle(items[index].title);
    setEditSummary(items[index].summary);
    setEditTags((items[index].tags || []).join(", "));
  };

  const handleSaveEdit = (index) => {
    const updated = itemsRef.current.map((item, i) =>
      i === index ? { ...item, title: editTitle, summary: editSummary, tags: editTags.split(",").map((t) => t.trim()).filter(Boolean) } : item
    );
    itemsRef.current = updated;
    setItems([...updated]);
    setEditingIndex(-1);
  };

  const handleCancelEdit = () => setEditingIndex(-1);

  /* ─── Reorder handlers ─── */
  const handleMoveUp = (index) => {
    if (index === 0) return;
    const updated = [...itemsRef.current];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    itemsRef.current = updated;
    setItems(updated);
  };

  const handleMoveDown = (index) => {
    if (index >= items.length - 1) return;
    const updated = [...itemsRef.current];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    itemsRef.current = updated;
    setItems(updated);
  };

  const handleDeleteItem = (index) => {
    const updated = itemsRef.current.filter((_, i) => i !== index);
    itemsRef.current = updated;
    setItems(updated);
  };

  /* ─── Retry handler ─── */
  const handleRetry = async (index) => {
    const item = itemsRef.current[index];
    if (!item || !apiKey) return;

    const loadingItem = { ...item, status: "loading" };
    const updated = itemsRef.current.map((i, idx) => idx === index ? loadingItem : i);
    itemsRef.current = updated;
    setItems([...updated]);

    try {
      const result = await summarizeLink(item.url, podcastName, episodeTitle, apiKey, customPrompt);
      const cache = loadCache();
      cache[getCacheKey(item.url, customPrompt)] = result;
      saveCache(cache);
      const doneUpdated = itemsRef.current.map((i, idx) =>
        idx === index ? { ...i, status: "done", ...result } : i
      );
      itemsRef.current = doneUpdated;
      setItems([...doneUpdated]);
    } catch (e) {
      const errUpdated = itemsRef.current.map((i, idx) =>
        idx === index ? { ...i, status: "error", title: "Could not summarize", summary: e.message } : i
      );
      itemsRef.current = errUpdated;
      setItems([...errUpdated]);
    }
  };

  /* ─── RSS Import ─── */
  const handleRSSImport = async () => {
    if (!rssUrl) return;
    setImportingRss(true);
    try {
      const rssLinks = await fetchRSSTitles(rssUrl);
      if (!rssLinks.length) throw new Error("No links found in RSS feed");
      // Append RSS links to the links textarea
      const existing = linksText.trim();
      const newText = existing ? existing + "\n" + rssLinks.join("\n") : rssLinks.join("\n");
      setLinksText(newText);
      setShowRssImport(false);
      setRssUrl("");
    } catch (e) {
      alert("RSS import failed: " + e.message);
    }
    setImportingRss(false);
  };

  /* ─── AI Suggest Tags ─── */
  const handleSuggestTags = async () => {
    if (doneItems.length < 2 || !apiKey) return;
    setSuggestingTags(true);
    try {
      const tags = await suggestCrossTags(items, apiKey);
      setSuggestedTags(tags);
    } catch {}
    setSuggestingTags(false);
  };

  const handleApplySuggestedTag = (tag) => {
    // Apply as an episode-level tag shown in the ep-info area
    // Toggle: remove if already present
    setSuggestedTags((prev) =>
      prev.some((t) => t === tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  /* ─── Output ─── */
  const formatArgs = [items, podcastName, episodeTitle, episodeNumber, episodeDate, sponsorText];

  const outputText = (() => {
    switch (outputFormat) {
      case "markdown": return formatMarkdown(...formatArgs);
      case "newsletter": return formatNewsletter(...formatArgs);
      case "html": return formatHTML(...formatArgs);
      case "social": return formatSocialThread(...formatArgs);
      default: return formatMarkdown(...formatArgs);
    }
  })();

  const renderedHTML = outputFormat === "html"
    ? outputText
    : outputFormat === "markdown"
      ? `<div style="font-family:Georgia,serif;color:${TEXT};line-height:1.7;">${outputText
          .replace(/^### (.+)$/gm, "<h3>$1</h3>")
          .replace(/^## (.+)$/gm, "<h2>$1</h2>")
          .replace(/^# (.+)$/gm, "<h1>$1</h1>")
          .replace(/^---$/gm, "<hr>")
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>")
          .replace(/\n\n/g, "</p><p>")
          .replace(/^(.+)$/gm, (m) => {
            if (m.startsWith("<h") || m.startsWith("<hr")) return m;
            // Links
            return m.replace(/🔗 (.+)/g, '<a href="$1" style="color:' + ACCENT + '">$1</a>');
          })
        }</p>`
      : null;

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <div className="header">
          <div className="eyebrow">✦ Weekly workflow tool</div>
          <h1>Show Notes<br /><span>Generator</span></h1>
          <p className="subtitle">Paste your curated links, get AI-written summaries formatted for your podcast show notes and newsletter.</p>
        </div>

        {/* API key input */}
        {!ENV_API_KEY && (
          <div className="api-key-banner">
            <span>API KEY</span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-..." />
          </div>
        )}

        {/* Config */}
        <div className="config-row">
          <div className="config-field">
            <label>Podcast Name</label>
            <input value={podcastName} disabled style={{ opacity: 0.5, cursor: "not-allowed" }} />
          </div>
          <div className="config-field">
            <label>Show Summary</label>
            <input value={episodeTitle} onChange={(e) => setEpisodeTitle(e.target.value)} placeholder="This week's episode..." />
          </div>
          <div className="config-field" style={{ maxWidth: 120 }}>
            <label>Episode #</label>
            <input value={episodeNumber} onChange={(e) => setEpisodeNumber(e.target.value)} placeholder="42" type="number" />
          </div>
        </div>

        {/* Date & Sponsor toggles */}
        <div className="inline-actions">
          <button className="collapsible-toggle" onClick={() => setEpisodeDate(episodeDate ? "" : new Date().toISOString().split("T")[0])}>
            {episodeDate ? "▾" : "▸"} {episodeDate ? `Date: ${episodeDate}` : "Set custom date"}
          </button>
          <button className="collapsible-toggle" onClick={() => setShowSponsor(!showSponsor)}>
            {showSponsor ? "▾" : "▸"} {showSponsor ? "Sponsor set" : "Add sponsor slot"}
          </button>
          <button className="collapsible-toggle" onClick={() => setShowCustomPrompt(!showCustomPrompt)}>
            {showCustomPrompt ? "▾" : "▸"} {showCustomPrompt ? "Custom prompt active" : "Custom prompt"}
          </button>
          <button className="collapsible-toggle" onClick={() => setShowRssImport(!showRssImport)}>
            {showRssImport ? "▾" : "▸"} RSS Import
          </button>
        </div>

        {/* Date field */}
        {episodeDate && (
          <div className="config-row" style={{ marginTop: -12 }}>
            <div className="config-field" style={{ maxWidth: 200 }}>
              <label>Episode Date</label>
              <input type="date" value={episodeDate} onChange={(e) => setEpisodeDate(e.target.value)} />
            </div>
          </div>
        )}

        {/* Sponsor field */}
        {showSponsor && (
          <div className="sponsor-field">
            <div className="link-input-area" style={{ marginBottom: 16 }}>
              <label>Sponsor message (inserted at end of output)</label>
              <textarea value={sponsorText} onChange={(e) => setSponsorText(e.target.value)} placeholder="This episode is brought to you by..." style={{ minHeight: 60 }} />
            </div>
          </div>
        )}

        {/* Custom prompt */}
        {showCustomPrompt && (
          <div className="collapsible-content" style={{ marginBottom: 16 }}>
            <div className="link-input-area">
              <label>Custom AI prompt override (optional)</label>
              <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder={`Leave blank to use the default prompt.\n\nCustom example: "Summarize in a humorous tone, max 2 sentences."`} style={{ minHeight: 80, fontSize: 12 }} />
            </div>
          </div>
        )}

        {/* RSS Import */}
        {showRssImport && (
          <div className="collapsible-content" style={{ marginBottom: 16 }}>
            <div className="link-input-area" style={{ padding: 16 }}>
              <label>RSS Feed URL</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={rssUrl}
                  onChange={(e) => setRssUrl(e.target.value)}
                  placeholder="https://example.com/feed.xml"
                  style={{ flex: 1, fontFamily: "'DM Mono', monospace", fontSize: 12, padding: "8px 12px" }}
                />
                <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 12 }} onClick={handleRSSImport} disabled={!rssUrl || importingRss}>
                  {importingRss ? "Importing…" : "Import"}
                </button>
              </div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: MUTED, marginTop: 8 }}>
                Extracts links from the most recent items/entries.
              </div>
            </div>
          </div>
        )}

        {/* Link input */}
        <div className="link-input-area">
          <label>
            Paste links — one per line or comma-separated
            {duplicateCount > 0 && <span className="duplicate-badge" style={{ marginLeft: 12 }}>⚠ {duplicateCount} duplicate{duplicateCount > 1 ? "s" : ""} in input</span>}
          </label>
          <textarea
            value={linksText}
            onChange={(e) => setLinksText(e.target.value)}
            placeholder={"https://example.com/article\nhttps://another.com/post\nhttps://youtube.com/watch?v=..."}
          />
        </div>

        {/* Actions */}
        <div className="actions">
          <button className="btn-primary" onClick={handleGenerate} disabled={!canGenerate}>
            {isRunning ? (
              <><div className="spinner" style={{ borderTopColor: "#000" }} /> Generating…</>
            ) : items.length > 0 ? (
              <>✦ Add Links</>
            ) : (
              <>✦ Generate Show Notes</>
            )}
          </button>
          {(items.length > 0 || linksText.trim()) && !isRunning && (
            <button className="btn-secondary" onClick={handleSaveDraft}>
              {currentEpisodeId ? "↑ Update Draft" : "Save Draft"}
            </button>
          )}
          {items.length > 0 && !isRunning && (
            <button className="btn-secondary" onClick={handleClear}>Clear All</button>
          )}
          {doneItems.length >= 2 && apiKey && !isRunning && (
            <button className="btn-secondary" onClick={handleSuggestTags} disabled={suggestingTags}>
              {suggestingTags ? "Suggesting…" : "🏷 Suggest tags"}
            </button>
          )}
        </div>

        {/* Items list */}
        {items.length > 0 && (
          <>
            {isRunning && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            )}

            <div className="format-tabs">
              <button className={`tab ${activeTab === "cards" ? "active" : ""}`} onClick={() => setActiveTab("cards")}>Preview</button>
              {!isRunning && doneItems.length > 0 && (
                <button className={`tab ${activeTab === "export" ? "active" : ""}`} onClick={() => setActiveTab("export")}>Export</button>
              )}
            </div>

            {activeTab === "cards" && (
              <div>
                {/* Episode info bar */}
                {(episodeTitle || podcastName) && (
                  <div className="ep-info">
                    {podcastName && <span>{podcastName}</span>}
                    {podcastName && episodeNumber && <span> · Ep. {episodeNumber}</span>}
                    {episodeTitle && <span> — {episodeTitle}</span>}
                    {episodeDate && <span> · {new Date(episodeDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>}
                    {suggestedTags.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {suggestedTags.map((tag) => (
                          <span key={tag} className="tag" style={{ cursor: "pointer", borderColor: ACCENT + "44" }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {items.map((item, i) => (
                  <div key={i} className={`item-card ${item.status === "loading" ? "loading" : ""} ${editingIndex === i ? "editing" : ""}`}>
                    {/* Card actions (hover) */}
                    {item.status !== "loading" && editingIndex !== i && (
                      <div className="card-actions">
                        <button className="btn-small" onClick={() => handleMoveUp(i)} title="Move up" disabled={i === 0}>↑</button>
                        <button className="btn-small" onClick={() => handleMoveDown(i)} title="Move down" disabled={i >= items.length - 1}>↓</button>
                        <button className="btn-small" onClick={() => handleStartEdit(i)} title="Edit">✎</button>
                        <button className="btn-danger" onClick={() => handleDeleteItem(i)} title="Remove">✕</button>
                      </div>
                    )}

                    <a className="item-url" href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>

                    {item.status === "loading" && (
                      <div className="item-loading"><div className="spinner" />Fetching & summarizing…</div>
                    )}

                    {item.status === "error" && (
                      <>
                        <div className="item-error">⚠ {item.summary}</div>
                        <button className="btn-retry" onClick={() => handleRetry(i)} disabled={isRunning}>↻ Retry</button>
                      </>
                    )}

                    {item.status === "done" && editingIndex === i && (
                      <>
                        <input className="edit-field" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
                        <textarea className="edit-field" value={editSummary} onChange={(e) => setEditSummary(e.target.value)} placeholder="Summary" style={{ minHeight: 80, resize: "vertical" }} />
                        <input className="edit-field" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="Tags (comma-separated)" style={{ fontSize: 12 }} />
                        <div className="edit-actions">
                          <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 12 }} onClick={() => handleSaveEdit(i)}>Save</button>
                          <button className="btn-secondary" style={{ padding: "8px 16px", fontSize: 12 }} onClick={handleCancelEdit}>Cancel</button>
                        </div>
                      </>
                    )}

                    {item.status === "done" && editingIndex !== i && (
                      <>
                        <div className="item-title">{item.title}</div>
                        <div className="item-summary">{item.summary}</div>
                        {item.tags?.length > 0 && (
                          <div style={{ marginTop: 14 }}>
                            {item.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Export tab */}
            {activeTab === "export" && doneItems.length > 0 && (
              <div>
                <div className="notes-header">
                  <div>
                    <div className="section-label">Formatted output</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button className={`tab ${outputFormat === "markdown" ? "active" : ""}`} onClick={() => setOutputFormat("markdown")}>Markdown</button>
                      <button className={`tab ${outputFormat === "newsletter" ? "active" : ""}`} onClick={() => setOutputFormat("newsletter")}>Newsletter</button>
                      <button className={`tab ${outputFormat === "html" ? "active" : ""}`} onClick={() => setOutputFormat("html")}>HTML</button>
                      <button className={`tab ${outputFormat === "social" ? "active" : ""}`} onClick={() => setOutputFormat("social")}>Social</button>
                    </div>
                  </div>
                  <button className="copy-btn" onClick={handleCopy}>{copied ? "✓ Copied!" : "Copy all"}</button>
                </div>

                {/* Markdown Preview toggle */}
                {outputFormat === "markdown" && (
                  <div style={{ marginBottom: 12 }}>
                    <button className="collapsible-toggle" onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}>
                      {showMarkdownPreview ? "▾ Hide preview" : "▸ Show rendered preview"}
                    </button>
                  </div>
                )}

                {showMarkdownPreview && outputFormat === "markdown" && (
                  <div className="output-box" style={{ marginBottom: 16 }}>
                    <div className="output-html-preview" dangerouslySetInnerHTML={{ __html: renderedHTML }} />
                  </div>
                )}

                <div className="output-box">
                  <pre className="output-text">{outputText}</pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Episodes Panel ─── */}
      <div style={{ maxWidth: 640, margin: "24px auto 0", padding: "0 16px 48px" }}>
        <button
          onClick={() => setShowEpisodes((v) => !v)}
          style={{
            background: "none",
            border: `1px solid ${BORDER}`,
            color: episodes.length > 0 ? TEXT : MUTED,
            padding: "8px 14px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 10 }}>{showEpisodes ? "▲" : "▼"}</span>
          Episodes {episodes.length > 0 ? `(${episodes.filter(e => e.status === "draft").length} draft · ${episodes.filter(e => e.status === "done").length} done)` : ""}
        </button>

        {showEpisodes && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Drafts section */}
            {episodes.some(e => e.status === "draft") && (
              <div>
                <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>In Progress</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {episodes.filter(e => e.status === "draft").map((ep) => {
                    const date = new Date(ep.updatedAt || ep.createdAt);
                    const label = [ep.podcastName, ep.episodeTitle, ep.episodeNumber && `#${ep.episodeNumber}`].filter(Boolean).join(" · ");
                    const doneCount = (ep.items || []).filter(i => i.status === "done").length;
                    const pendingCount = (ep.pendingLinks || "").trim().split(/[\n,]+/).filter(u => u.trim()).length;
                    const isActive = ep.id === currentEpisodeId;
                    return (
                      <div key={ep.id} style={{ background: CARD, border: `1px solid ${isActive ? ACCENT : BORDER}`, borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {label || "Untitled Episode"}
                            {isActive && <span style={{ marginLeft: 8, fontSize: 10, color: ACCENT, fontWeight: 400 }}>● active</span>}
                          </div>
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                            {doneCount} generated{pendingCount > 0 ? ` · ${pendingCount} pending` : ""} · saved {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            onClick={() => {
                              setPodcastName(ep.podcastName || "");
                              setEpisodeTitle(ep.episodeTitle || "");
                              setEpisodeNumber(ep.episodeNumber || "");
                              setEpisodeDate(ep.episodeDate || "");
                              setItems(ep.items || []);
                              itemsRef.current = ep.items || [];
                              setLinksText(ep.pendingLinks || "");
                              setCurrentEpisodeId(ep.id);
                              setActiveTab("cards");
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            style={{ background: ACCENT, color: BG, border: "none", padding: "5px 12px", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                          >
                            Continue
                          </button>
                          <button
                            onClick={() => {
                              const updated = { ...ep, status: "done", updatedAt: new Date().toISOString() };
                              upsertEpisode(updated);
                              setEpisodes(loadEpisodes());
                            }}
                            style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 12 }}
                          >
                            ✓ Done
                          </button>
                          <button
                            onClick={() => {
                              const updated = episodes.filter(e => e.id !== ep.id);
                              localStorage.setItem(EPISODE_KEY, JSON.stringify(updated));
                              setEpisodes(updated);
                            }}
                            style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 12 }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Archive section */}
            {episodes.some(e => e.status === "done") && (
              <div>
                <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Archive</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {episodes.filter(e => e.status === "done").map((ep) => {
                    const date = new Date(ep.updatedAt || ep.createdAt);
                    const label = [ep.podcastName, ep.episodeTitle, ep.episodeNumber && `#${ep.episodeNumber}`].filter(Boolean).join(" · ");
                    const doneCount = (ep.items || []).filter(i => i.status === "done").length;
                    return (
                      <div key={ep.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, opacity: 0.8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {label || "Untitled Episode"}
                          </div>
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                            {doneCount} link{doneCount !== 1 ? "s" : ""} · {date.toLocaleDateString()}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            onClick={() => {
                              setPodcastName(ep.podcastName || "");
                              setEpisodeTitle(ep.episodeTitle || "");
                              setEpisodeNumber(ep.episodeNumber || "");
                              setEpisodeDate(ep.episodeDate || "");
                              setItems(ep.items || []);
                              itemsRef.current = ep.items || [];
                              setLinksText("");
                              setCurrentEpisodeId(ep.id);
                              setActiveTab("cards");
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            style={{ background: "none", border: `1px solid ${BORDER}`, color: TEXT, padding: "5px 12px", borderRadius: 5, cursor: "pointer", fontSize: 12 }}
                          >
                            View
                          </button>
                          <button
                            onClick={() => {
                              const updated = episodes.filter(e => e.id !== ep.id);
                              localStorage.setItem(EPISODE_KEY, JSON.stringify(updated));
                              setEpisodes(updated);
                            }}
                            style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 12 }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {episodes.length === 0 && (
              <div style={{ fontSize: 13, color: MUTED, padding: "8px 0" }}>No episodes yet. Save a draft or generate to get started.</div>
            )}

            {episodes.length > 0 && (
              <button
                onClick={() => { localStorage.removeItem(EPISODE_KEY); setEpisodes([]); setCurrentEpisodeId(null); }}
                style={{ background: "none", border: "none", color: MUTED, fontSize: 11, cursor: "pointer", alignSelf: "flex-end", padding: "4px 0" }}
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
