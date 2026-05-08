import { useState, useRef } from "react";

const ACCENT = "#E8FF47";
const BG = "#0D0D0D";
const CARD = "#161616";
const BORDER = "#2A2A2A";
const MUTED = "#666";
const TEXT = "#F0F0F0";

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
  }

  @keyframes fadeSlide {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .item-card:hover { border-color: #333; }
  .item-card.loading { border-color: ${ACCENT}33; }

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

  .format-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 20px;
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
`;

// API key: uses env var in production, or falls back to user-entered key
const ENV_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

async function summarizeLink(url, podcastName, episodeTitle, apiKey) {
  const prompt = `You are a research assistant for a podcast called "${podcastName || 'the podcast'}".

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
      messages: [{ role: "user", content: prompt }],
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
  return JSON.parse(clean);
}

function formatMarkdown(items, podcastName, episodeTitle, episodeNumber) {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let out = "";
  if (episodeTitle) out += `# ${episodeNumber ? `Ep. ${episodeNumber}: ` : ""}${episodeTitle}\n`;
  if (podcastName) out += `**${podcastName}** · ${date}\n`;
  out += "\n---\n\n## Links & Resources\n\n";
  items.forEach((item, i) => {
    if (item.status !== "done") return;
    out += `### ${i + 1}. ${item.title}\n`;
    out += `🔗 ${item.url}\n\n`;
    out += `${item.summary}\n\n`;
    if (item.tags?.length) out += `*Tags: ${item.tags.join(", ")}*\n`;
    out += "\n";
  });
  return out.trim();
}

function formatNewsletter(items, podcastName, episodeTitle, episodeNumber) {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let out = "";
  if (episodeTitle) {
    out += `${episodeNumber ? `Episode ${episodeNumber}: ` : ""}${episodeTitle}\n`;
    out += "=".repeat(60) + "\n\n";
  }
  out += `This week on ${podcastName || "the podcast"} (${date}), here's what we're covering:\n\n`;
  items.forEach((item, i) => {
    if (item.status !== "done") return;
    out += `${i + 1}. ${item.title.toUpperCase()}\n`;
    out += `${item.summary}\n`;
    out += `Read more: ${item.url}\n\n`;
  });
  return out.trim();
}

export default function ShowNotesGenerator() {
  const [apiKey, setApiKey] = useState(ENV_API_KEY);
  const [podcastName, setPodcastName] = useState("");
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [episodeNumber, setEpisodeNumber] = useState("");
  const [linksText, setLinksText] = useState("");
  const [items, setItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState("cards");
  const [copied, setCopied] = useState(false);
  const [outputFormat, setOutputFormat] = useState("markdown");
  const itemsRef = useRef([]);

  const parseLinks = (text) =>
    text.split(/[\n,]+/).map((l) => l.trim()).filter((l) => l.match(/^https?:\/\//));

  const progress = items.length
    ? Math.round((items.filter((i) => i.status !== "loading").length / items.length) * 100)
    : 0;

  const handleGenerate = async () => {
    const links = parseLinks(linksText);
    if (!links.length || !apiKey) return;

    const existingUrls = new Set(itemsRef.current.map((i) => i.url));
    const newLinks = links.filter((url) => !existingUrls.has(url));
    if (!newLinks.length) return;

    const newItems = newLinks.map((url) => ({ url, status: "loading", title: "", summary: "", tags: [] }));
    const combined = [...itemsRef.current, ...newItems];
    setItems(combined);
    itemsRef.current = combined;
    setIsRunning(true);
    setActiveTab("cards");
    setLinksText("");

    await Promise.all(
      newLinks.map(async (url) => {
        try {
          const result = await summarizeLink(url, podcastName, episodeTitle, apiKey);
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

    setIsRunning(false);
  };

  const handleClear = () => {
    setItems([]);
    setLinksText("");
    itemsRef.current = [];
  };

  const outputText =
    outputFormat === "markdown"
      ? formatMarkdown(items, podcastName, episodeTitle, episodeNumber)
      : formatNewsletter(items, podcastName, episodeTitle, episodeNumber);

  const handleCopy = () => {
    navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doneItems = items.filter((i) => i.status === "done");
  const canGenerate = apiKey && parseLinks(linksText).length > 0 && !isRunning;

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <div className="header">
          <div className="eyebrow">✦ Weekly workflow tool</div>
          <h1>Show Notes<br /><span>Generator</span></h1>
          <p className="subtitle">Paste your curated links, get AI-written summaries formatted for your podcast show notes and newsletter.</p>
        </div>

        {/* API key input — only shown if no env var is set */}
        {!ENV_API_KEY && (
          <div className="api-key-banner">
            <span>API KEY</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
            />
          </div>
        )}

        <div className="config-row">
          <div className="config-field">
            <label>Podcast Name</label>
            <input value={podcastName} onChange={(e) => setPodcastName(e.target.value)} placeholder="My Weekly Show" />
          </div>
          <div className="config-field">
            <label>Episode Title</label>
            <input value={episodeTitle} onChange={(e) => setEpisodeTitle(e.target.value)} placeholder="This week's episode..." />
          </div>
          <div className="config-field" style={{ maxWidth: 120 }}>
            <label>Episode #</label>
            <input value={episodeNumber} onChange={(e) => setEpisodeNumber(e.target.value)} placeholder="42" type="number" />
          </div>
        </div>

        <div className="link-input-area">
          <label>Paste links — one per line or comma-separated</label>
          <textarea
            value={linksText}
            onChange={(e) => setLinksText(e.target.value)}
            placeholder={"https://example.com/article\nhttps://another.com/post\nhttps://youtube.com/watch?v=..."}
          />
        </div>

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
          {items.length > 0 && !isRunning && (
            <button className="btn-secondary" onClick={handleClear}>Clear</button>
          )}
        </div>

        {items.length > 0 && (
          <>
            {isRunning && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            )}

            <div className="format-tabs">
              <button className={`tab ${activeTab === "cards" ? "active" : ""}`} onClick={() => setActiveTab("cards")}>
                Preview
              </button>
              {!isRunning && doneItems.length > 0 && (
                <button className={`tab ${activeTab === "export" ? "active" : ""}`} onClick={() => setActiveTab("export")}>
                  Export
                </button>
              )}
            </div>

            {activeTab === "cards" && (
              <div>
                {(episodeTitle || podcastName) && (
                  <div className="ep-info">
                    {podcastName && <span>{podcastName}</span>}
                    {podcastName && episodeNumber && <span> · Ep. {episodeNumber}</span>}
                    {episodeTitle && <span> — {episodeTitle}</span>}
                  </div>
                )}
                {items.map((item, i) => (
                  <div key={i} className={`item-card ${item.status === "loading" ? "loading" : ""}`}>
                    <a className="item-url" href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>
                    {item.status === "loading" && (
                      <div className="item-loading"><div className="spinner" />Fetching & summarizing…</div>
                    )}
                    {item.status === "error" && <div className="item-error">⚠ {item.summary}</div>}
                    {item.status === "done" && (
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

            {activeTab === "export" && doneItems.length > 0 && (
              <div>
                <div className="notes-header">
                  <div>
                    <div className="section-label">Formatted output</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button className={`tab ${outputFormat === "markdown" ? "active" : ""}`} onClick={() => setOutputFormat("markdown")}>Markdown</button>
                      <button className={`tab ${outputFormat === "newsletter" ? "active" : ""}`} onClick={() => setOutputFormat("newsletter")}>Newsletter</button>
                    </div>
                  </div>
                  <button className="copy-btn" onClick={handleCopy}>{copied ? "✓ Copied!" : "Copy all"}</button>
                </div>
                <div className="output-box">
                  <pre className="output-text">{outputText}</pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
