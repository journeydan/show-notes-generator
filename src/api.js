function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

async function callAnthropic(body, apiKey) {
  // Try proxy first (local dev with server running)
  try {
    const resp = await fetch("/api/anthropic/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (resp.ok) return await resp.json();
  } catch {}
  // Fallback: direct API call from browser (needs dangerous header for CORS)
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  return await resp.json();
}

export async function summarizeLink(url, podcastName, episodeTitle, apiKey, customPrompt) {
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

  const response = await callAnthropic({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: systemPrompt }],
  }, apiKey);

  const text = response.content
    ? response.content.filter((b) => b.type === "text").map((b) => b.text).join("")
    : "";

  if (!text && response.error) throw new Error(response?.error?.message || `API error`);

  const clean = text.replace(/```json|```/g, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { title: extractDomain(url), summary: "Could not retrieve a summary. Visit the link directly.", tags: [] };
  try { return JSON.parse(jsonMatch[0]); }
  catch { return { title: extractDomain(url), summary: "Could not retrieve a summary. Visit the link directly.", tags: [] }; }
}

export async function suggestCrossTags(items, apiKey) {
  const summaries = items
    .filter((i) => i.status === "done")
    .map((i, idx) => `[${idx + 1}] "${i.title}": ${i.summary}`)
    .join("\n\n");

  const prompt = `Below is a list of articles/resources for a podcast episode's show notes. Based on ALL of them together, suggest 3-8 broad topic tags that describe the episode as a whole.

${summaries}

Return ONLY a JSON array of tag strings, no markdown, no preamble. Example: ["AI", "Technology", "Startups"]`;

  const response = await callAnthropic({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  }, apiKey);

  if (response.error) return [];
  const text = response.content?.filter((b) => b.type === "text").map((b) => b.text).join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); } catch { return []; }
}

export async function fetchRSSTitles(url) {
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
