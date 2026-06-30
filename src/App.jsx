import { useState, useRef, useEffect } from "react";
import { formatMarkdown, formatNewsletter, formatHTML, formatSocialThread } from "./formatters.js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { loadState, saveState, loadCache, saveCache, fetchEpisodeList, fetchEpisode, saveEpisode, deleteEpisode, getCacheKey } from "./storage.js";
import { summarizeLink, suggestCrossTags, fetchRSSTitles } from "./api.js";

/* ─── Constants ─── */
const ACCENT = "#E8FF47";
const TEXT = "#F0F0F0";

const BATCH_SIZE = 3;

function parseLinks(text) {
  return text.split(/[\n,]+/).map((l) => l.trim()).filter((l) => l.match(/^https?:\/\//));
}

function fmtDate(dateStr, style) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const local = new Date(y, m - 1, d);
  if (style === "long") return local.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return local.toLocaleDateString();
}

const ENV_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";
const ENV_CRAFT_KEY = import.meta.env.VITE_CRAFT_API_KEY || "";
const CRAFT_MCP_URL = "https://mcp.craft.do/links/7foILXddSEb/mcp";
const CRAFT_FOLDER = "9477946A-1CFA-454B-BDAC-7C9E0970EB61";

/* ─── Component ─── */
export default function ShowNotesGenerator() {
  const [apiKey, setApiKey] = useState(ENV_API_KEY);
  const [craftKey, setCraftKey] = useState(() => localStorage.getItem("craft-api-key") || ENV_CRAFT_KEY);
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
  const [episodes, setEpisodes] = useState([]);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [currentEpisodeSlug, setCurrentEpisodeSlug] = useState(null);
  const [doneSlugs, setDoneSlugs] = useState(() => {
    try {
      const raw = localStorage.getItem("show-notes-done-slugs");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [pulling, setPulling] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  const itemsRef = useRef([]);
  const syncTimerRef = useRef(null);
  const initialized = useRef(false);

  function setSyncMessageWithTimeout(msg, duration = 3000) {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    setSyncMessage(msg);
    syncTimerRef.current = setTimeout(() => setSyncMessage(""), duration);
  }

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
      setHydrating(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized.current) return;
    saveState({ podcastName, episodeTitle, episodeNumber, episodeDate, showSponsor, sponsorText, customPrompt, showCustomPrompt, items });
  }, [podcastName, episodeTitle, episodeNumber, episodeDate, showSponsor, sponsorText, customPrompt, showCustomPrompt, items]);

  /* ─── Episode loading ─── */
  const loadEpisodes = async () => {
    try {
      const data = await fetchEpisodeList();
      setEpisodes(data);
    } catch (e) {
      console.error("Failed to load episodes:", e);
    }
  };

  useEffect(() => {
    loadEpisodes();
  }, []);

  // Persist done slugs to localStorage
  useEffect(() => {
    localStorage.setItem("show-notes-done-slugs", JSON.stringify(doneSlugs));
  }, [doneSlugs]);

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
      try {
        const result = await saveEpisode({
          number: episodeNumber,
          title: episodeTitle,
          podcast: podcastName,
          date: episodeDate,
          items: finalItems,
          sponsorText,
          linksText: "",
        });
        setCurrentEpisodeSlug(result.slug);
        await loadEpisodes();
      } catch (e) {
        console.error("Auto-save failed:", e);
      }
    }
  };

  const handleClear = () => {
    setItems([]);
    setLinksText("");
    itemsRef.current = [];
    setSuggestedTags([]);
    setCurrentEpisodeSlug(null);
  };

  const handleSaveDraft = async () => {
    try {
      const result = await saveEpisode({
        number: episodeNumber || (currentEpisodeSlug ? currentEpisodeSlug.replace("episode-", "") : ""),
        title: episodeTitle,
        podcast: podcastName,
        date: episodeDate,
        items: itemsRef.current,
        sponsorText,
        linksText,
      });
      setCurrentEpisodeSlug(result.slug);
      await loadEpisodes();
      return result;
    } catch (e) {
      console.error("Save draft failed:", e);
      return null;
    }
  };

  async function callMCP(method, params) {
    const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
    if (craftKey) headers["Authorization"] = `Bearer ${craftKey}`;
    // Always initialize first (stateless calls)
    await fetch(CRAFT_MCP_URL, { method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ShowNotesGen", version: "1.0" } }, id: 1 })
    });
    const resp = await fetch(CRAFT_MCP_URL, { method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, id: 2, params })
    });
    const text = await resp.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) return JSON.parse(line.slice(6));
    }
    return null;
  }

  async function handleSyncToCraft() {
    if (!craftKey) { setSyncMessageWithTimeout("Set Craft API key first"); return; }
    setSyncing(true);
    setSyncMessage("");
    try {
      const result = await saveEpisode({
        number: episodeNumber || (currentEpisodeSlug ? currentEpisodeSlug.replace("episode-", "") : ""),
        title: episodeTitle,
        podcast: podcastName,
        date: episodeDate,
        items: itemsRef.current,
        sponsorText,
        linksText,
      });
      const slug = result.slug;
      const fullTitle = [podcastName, episodeNumber ? `Ep. ${episodeNumber}` : "", episodeTitle].filter(Boolean).join(" · ") || slug;
      const escapedTitle = fullTitle.replace(/"/g, '\\"');

      // Build markdown body
      const doneItems = (result.items || itemsRef.current || []).filter(i => i.status === "done");
      const bodyMd = doneItems.map((item, i) =>
        `## ${i + 1}. ${item.title}\n\n🔗 ${item.url}\n\n${item.summary}\n` + (item.tags?.length ? `\n*Tags: ${item.tags.join(", ")}*\n` : "")
      ).join("\n");

      // Step 1: Search for existing Craft doc with this slug
      const listResp = await callMCP("tools/call", {
        name: "craft_read",
        arguments: { command: `documents list --folder ${CRAFT_FOLDER}` }
      });

      // Look for existing doc by embedded slug marker
      const listText = listResp?.result?.content?.[0]?.text || "";
      const slugMarker = `[${slug}]`;
      let existingDocId = null;

      // Parse the document list — format: <rootBlockId> Title
      const docLines = listText.split("\n");
      for (const line of docLines) {
        const match = line.match(/<(\S+)>\s+(.+)/);
        if (match && match[2].includes(slugMarker)) {
          existingDocId = match[1];
          break;
        }
      }

      if (existingDocId) {
        // Update existing document: read children, delete them, add new content
        const getResp = await callMCP("tools/call", {
          name: "craft_read",
          arguments: { command: `blocks get ${existingDocId} --depth 1 --format json` }
        });

        // Delete child blocks (skip root block ID)
        const getText = getResp?.result?.content?.[0]?.text || "";
        const blockIds = getText.match(/"[^"]*blockId[^"]*":\s*"([^"]+)"/g)?.map(s => {
          const m = s.match(/"([^"]+)"/);
          return m ? m[1] : null;
        }).filter(id => id && id !== existingDocId) || [];

        for (const bid of blockIds) {
          await callMCP("tools/call", {
            name: "craft_write",
            arguments: { command: `blocks delete --id ${bid}` }
          });
        }

        // Add new content
        if (bodyMd) {
          await callMCP("tools/call", {
            name: "craft_write",
            arguments: { command: `blocks add --id ${existingDocId} --markdown "${bodyMd.replace(/"/g, '\\"')}"` }
          });
        }

        setSyncMessageWithTimeout("Updated in Craft!");
      } else {
        // Create new document with slug marker in title
        const createResp = await callMCP("tools/call", {
          name: "craft_write",
          arguments: { command: `documents create --title "${escapedTitle} ${slugMarker}" --folder ${CRAFT_FOLDER}` }
        });

        const contentText = createResp?.result?.content?.[0]?.text || "";
        const rootMatch = contentText.match(/rootBlockId: (\S+)/);
        if (!rootMatch) throw new Error("Could not create document: " + contentText);
        const rootId = rootMatch[1];

        if (bodyMd) {
          await callMCP("tools/call", {
            name: "craft_write",
            arguments: { command: `blocks add --id ${rootId} --markdown "${bodyMd.replace(/"/g, '\\"')}"` }
          });
        }

        setSyncMessageWithTimeout("Synced to Craft!");
      }
    } catch (e) {
      console.error("Craft sync error:", e);
      setSyncMessageWithTimeout("Sync failed: " + e.message, 4000);
    }
    setSyncing(false);
  }

  async function handlePullFromCraft() {
    if (!craftKey) { setSyncMessageWithTimeout("Set Craft API key first"); return; }
    setPulling(true);
    setSyncMessage("");
    try {
      const slug = currentEpisodeSlug;
      if (!slug) { setSyncMessageWithTimeout("No episode loaded", 2000); return; }
      const slugMarker = `[${slug}]`;

      // Find the Craft doc
      const listResp = await callMCP("tools/call", {
        name: "craft_read",
        arguments: { command: `documents list --folder ${CRAFT_FOLDER}` }
      });
      const listText = listResp?.result?.content?.[0]?.text || "";
      let foundId = null;
      for (const line of listText.split("\n")) {
        const m = line.match(/<(\S+)>\s+(.+)/);
        if (m && m[2].includes(slugMarker)) { foundId = m[1]; break; }
      }
      if (!foundId) { setSyncMessageWithTimeout("No Craft doc found for this episode"); setPulling(false); return; }

      // Read the document content
      const getResp = await callMCP("tools/call", {
        name: "craft_read",
        arguments: { command: `blocks get ${foundId} --format markdown` }
      });
      const mdText = getResp?.result?.content?.[0]?.text || "";

      // Parse markdown into items
      const parsedItems = [];

      // Strip <page>/<pageTitle>/<content> HTML wrapper tags that Craft may return
      let bodyText = mdText
        .replace(/<\/?(?:page|pageTitle|content)>/gi, "")
        .trim();
      // Also try explicit <content> extraction as fallback
      const contentMatch = mdText.match(/<content>([\s\S]*?)<\/content>/i);
      if (contentMatch) bodyText = contentMatch[1].trim();

      const blocks = bodyText.split(/\n## /);
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split("\n").map(l => l.trim()).filter(l => l);
        const title = lines[0].replace(/^\d+\.\s*/, "").trim();
        let url = "", summary = "", tags = [];

        for (const l of lines) {
          // URL: handle bare URL (🔗 https://…) or markdown link (🔗 [text](url))
          const mdLink = l.match(/🔗\s*\[([^\]]*)\]\(([^)]+)\)/);
          const bareUrl = l.match(/🔗\s*(https?:\/\/\S+)/);
          if (mdLink) url = mdLink[2];
          else if (bareUrl) url = bareUrl[1];

          const tagMatch = l.match(/\*Tags:\s*(.+)\*/);
          if (tagMatch) tags = tagMatch[1].split(",").map(t => t.trim());

          // Summary: first non-header, non-URL, non-tag line per block
          if (!l.startsWith("#") && !l.startsWith("🔗") && !l.startsWith("*Tags:") && !tagMatch && !summary) {
            summary = l.trim();
          }
        }
        if (url) parsedItems.push({ url, title, summary, tags, status: "done" });
      }

      // Update form state with pulled content
      if (parsedItems.length > 0) {
        setItems(parsedItems);
        itemsRef.current = parsedItems;
      }
      // Extract title from Craft doc title
      const titleMatch = mdText.match(/<pageTitle>([^<]+)<\/pageTitle>/);
      if (titleMatch) {
        const craftTitle = titleMatch[1].replace(` ${slugMarker}`, "").trim();
        const parts = craftTitle.split(" · ");
        if (parts.length >= 2) {
          setPodcastName(parts[0]);
          const epMatch = parts[1].match(/Ep\.\s*(\d+)/);
          if (epMatch) setEpisodeNumber(epMatch[1]);
          if (parts.length >= 3) setEpisodeTitle(parts.slice(2).join(" · "));
        }
      }

      setSyncMessageWithTimeout("Pulled from Craft!");
    } catch (e) {
      console.error("Craft pull error:", e);
      setSyncMessageWithTimeout("Pull failed: " + e.message, 4000);
    }
    setPulling(false);
  }

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
      ? DOMPurify.sanitize(marked.parse(outputText))
      : null;

  if (hydrating) {
    return (
      <div className="app" style={{ textAlign: "center", padding: "80px 24px" }}>
        <div className="eyebrow">✦ Weekly workflow tool</div>
        <h1 style={{ fontSize: "clamp(32px, 6vw, 52px)", fontWeight: 800, lineHeight: 1.05 }}>
          Show Notes<br /><span style={{ color: "#E8FF47" }}>Generator</span>
        </h1>
        <p style={{ color: "#666", marginTop: 16 }}>Loading…</p>
      </div>
    );
  }

  return (
    <>
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
        {!ENV_CRAFT_KEY && !craftKey && (
          <div className="api-key-banner" style={{ borderColor: "#E8FF4780" }}>
            <span>CRAFT KEY</span>
            <input type="password" value={craftKey} onChange={(e) => {
              setCraftKey(e.target.value);
              if (e.target.value) localStorage.setItem("craft-api-key", e.target.value);
            }} placeholder="pdk_..." />
          </div>
        )}

        {/* Config */}
        <div className="config-row">
          <div className="config-field">
            <label>Podcast Name</label>
            <input value={podcastName} disabled />
          </div>
          <div className="config-field">
            <label>Show Summary</label>
            <input value={episodeTitle} onChange={(e) => setEpisodeTitle(e.target.value)} placeholder="This week's episode..." />
          </div>
          <div className="config-field config-field-sm">
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
          <div className="config-row date-row">
            <div className="config-field config-field-md">
              <label>Episode Date</label>
              <input type="date" value={episodeDate} onChange={(e) => setEpisodeDate(e.target.value)} />
            </div>
          </div>
        )}

        {/* Sponsor field */}
        {showSponsor && (
          <div className="sponsor-field">
            <div className="link-input-area">
              <label>Sponsor message (inserted at end of output)</label>
              <textarea value={sponsorText} onChange={(e) => setSponsorText(e.target.value)} placeholder="This episode is brought to you by..." />
            </div>
          </div>
        )}

        {/* Custom prompt */}
        {showCustomPrompt && (
          <div className="collapsible-content collapsible-mb">
            <div className="link-input-area">
              <label>Custom AI prompt override (optional)</label>
              <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder={`Leave blank to use the default prompt.\n\nCustom example: "Summarize in a humorous tone, max 2 sentences."`} />
            </div>
          </div>
        )}

        {/* RSS Import */}
        {showRssImport && (
          <div className="collapsible-content collapsible-mb">
            <div className="link-input-area link-input-area-sm">
              <label>RSS Feed URL</label>
              <div className="rss-input-row">
                <input
                  value={rssUrl}
                  onChange={(e) => setRssUrl(e.target.value)}
                  placeholder="https://example.com/feed.xml"
                  className="rss-url-input"
                />
                <button className="btn-primary rss-import-btn" onClick={handleRSSImport} disabled={!rssUrl || importingRss}>
                  {importingRss ? "Importing…" : "Import"}
                </button>
              </div>
              <div className="rss-hint">
                Extracts links from the most recent items/entries.
              </div>
            </div>
          </div>
        )}

        {/* Link input */}
        <div className="link-input-area">
          <label>
            Paste links — one per line or comma-separated
            {duplicateCount > 0 && <span className="duplicate-badge">⚠ {duplicateCount} duplicate{duplicateCount > 1 ? "s" : ""} in input</span>}
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
              <><div className="spinner btn-spinner-dark" /> Generating…</>
            ) : items.length > 0 ? (
              <>✦ Add Links</>
            ) : (
              <>✦ Generate Show Notes</>
            )}
          </button>
          {(items.length > 0 || linksText.trim()) && !isRunning && (
            <button className="btn-secondary" onClick={handleSaveDraft}>
              {currentEpisodeSlug ? "↑ Update Draft" : "Save Draft"}
            </button>
          )}
          {(items.length > 0 || linksText.trim()) && !isRunning && (
            <button className="btn-craft" onClick={handleSyncToCraft} disabled={syncing}>
              {syncing ? "Syncing…" : syncMessage || "Sync to Craft"}
            </button>
          )}
          {currentEpisodeSlug && !isRunning && (
            <button className="btn-craft" onClick={handlePullFromCraft} disabled={pulling} style={{ borderColor: "#666", color: "#999" }}>
              {pulling ? "Pulling…" : "Pull from Craft"}
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
                    {episodeDate && <span> · {fmtDate(episodeDate, "long")}</span>}
                    {suggestedTags.length > 0 && (
                      <div className="suggested-tags-row">
                        {suggestedTags.map((tag) => (
                          <span key={tag} className="tag tag-suggested">{tag}</span>
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
                        <textarea className="edit-field edit-textarea" value={editSummary} onChange={(e) => setEditSummary(e.target.value)} placeholder="Summary" />
                        <input className="edit-field edit-tags-input" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="Tags (comma-separated)" />
                        <div className="edit-actions">
                          <button className="btn-primary edit-save-btn" onClick={() => handleSaveEdit(i)}>Save</button>
                          <button className="btn-secondary edit-cancel-btn" onClick={handleCancelEdit}>Cancel</button>
                        </div>
                      </>
                    )}

                    {item.status === "done" && editingIndex !== i && (
                      <>
                        <div className="item-title">{item.title}</div>
                        <div className="item-summary">{item.summary}</div>
                        {item.tags?.length > 0 && (
                          <div className="card-tags">
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
                    <div className="export-format-buttons">
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
                  <div className="md-preview-toggle">
                    <button className="collapsible-toggle" onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}>
                      {showMarkdownPreview ? "▾ Hide preview" : "▸ Show rendered preview"}
                    </button>
                  </div>
                )}

                {showMarkdownPreview && outputFormat === "markdown" && (
                  <div className="output-box md-preview-box">
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
      <div className="episodes-container">
        <button
          onClick={() => setShowEpisodes((v) => !v)}
          className={episodes.length > 0 ? "episodes-toggle" : "episodes-toggle empty"}
        >
          <span className="chevron">{showEpisodes ? "▲" : "▼"}</span>
          Episodes {episodes.length > 0 ? `(${episodes.filter(e => !doneSlugs.includes(e.slug)).length} draft · ${episodes.filter(e => doneSlugs.includes(e.slug)).length} done)` : ""}
        </button>

        {showEpisodes && (
          <div className="episodes-panel">

            <button
              className="btn-primary episodes-new-btn"
              onClick={async () => {
                const hadContent = episodeTitle || episodeNumber || items.length > 0 || linksText.trim();
                if (hadContent) {
                  // Save to localStorage as fallback first
                  saveState({ podcastName, episodeTitle, episodeNumber, episodeDate, showSponsor, sponsorText, customPrompt, showCustomPrompt, items });
                  try {
                    const saved = await handleSaveDraft();
                    // Mark as done so it appears in Archive — use returned slug not stale closure
                    const slug = saved?.slug || currentEpisodeSlug;
                    if (slug) {
                      setDoneSlugs(prev => prev.includes(slug) ? prev : [...prev, slug]);
                    }
                    await loadEpisodes();
                  } catch (e) {
                    console.error("Save failed, but data preserved in localStorage:", e);
                  }
                }
                setEpisodeTitle("");
                setEpisodeNumber("");
                setEpisodeDate("");
                setItems([]);
                itemsRef.current = [];
                setLinksText("");
                setSponsorText("");
                setShowSponsor(false);
                setCurrentEpisodeSlug(null);
                setShowEpisodes(true);
              }}
            >
              + New Episode
            </button>

            {/* Drafts section */}
            {episodes.some(e => !doneSlugs.includes(e.slug)) && (
              <div>
                <div className="episodes-section-label">In Progress</div>
                <div className="episodes-list">
                  {episodes.filter(e => !doneSlugs.includes(e.slug)).map((ep) => {
                    const label = [ep.podcast, ep.number && `Ep. ${ep.number}`, ep.title].filter(Boolean).join(" · ");
                    const isActive = ep.slug === currentEpisodeSlug;
                    return (
                      <div key={ep.slug} className={isActive ? "episode-card active" : "episode-card"}>
                        <div className="episode-card-minwidth">
                          <div className="episode-card-label">
                            {label || "Untitled Episode"}
                            {isActive && <span className="episode-active-badge">● active</span>}
                          </div>
                          <div className="episode-card-meta">
                            {ep.slug}{ep.date ? ` · ${fmtDate(ep.date)}` : ""}{ep.links?.length ? ` · ${ep.links.length} link${ep.links.length !== 1 ? "s" : ""}` : ""}
                          </div>
                        </div>
                        <div className="episode-card-actions">
                          <button
                            onClick={async () => {
                              // Save current state first
                              if (currentEpisodeSlug && (episodeTitle || episodeNumber || itemsRef.current.length > 0 || linksText.trim())) {
                                try {
                                  await saveEpisode({
                                    number: episodeNumber,
                                    title: episodeTitle,
                                    podcast: podcastName,
                                    date: episodeDate,
                                    items: itemsRef.current,
                                    sponsorText,
                                    linksText,
                                  });
                                } catch {}
                              }
                              // Load the selected episode
                              setPodcastName(ep.podcast || podcastName);
                              setEpisodeTitle(ep.title || "");
                              setEpisodeNumber(ep.number || "");
                              setEpisodeDate(ep.date || "");
                              const epData = await fetchEpisode(ep.slug);
                              if (epData && epData.items && epData.items.length > 0) {
                                setItems(epData.items);
                                itemsRef.current = epData.items;
                              } else {
                                setItems([]);
                                itemsRef.current = [];
                              }
                              setLinksText("");
                              setCurrentEpisodeSlug(ep.slug);
                              setActiveTab("cards");
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="episodes-continue-btn"
                          >
                            Continue
                          </button>
                          <button
                            onClick={async () => {
                              // Save to file with no pending links (marks as complete)
                              try {
                                await saveEpisode({
                                  number: ep.number || episodeNumber,
                                  title: ep.title || episodeTitle,
                                  podcast: ep.podcast || podcastName,
                                  date: ep.date || episodeDate,
                                  items: [],
                                  sponsorText: "",
                                  linksText: "",
                                });
                              } catch {}
                              setDoneSlugs(prev => [...prev, ep.slug]);
                              await loadEpisodes();
                            }}
                            className="episodes-done-btn"
                          >
                            ✓ Done
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await deleteEpisode(ep.slug);
                                setDoneSlugs(prev => prev.filter(s => s !== ep.slug));
                                await loadEpisodes();
                              } catch (e) {
                                console.error("Delete failed:", e);
                              }
                            }}
                            className="episodes-delete-btn"
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
            {episodes.some(e => doneSlugs.includes(e.slug)) && (
              <div>
                <div className="episodes-section-label">Archive</div>
                <div className="episodes-list">
                  {episodes.filter(e => doneSlugs.includes(e.slug)).map((ep) => {
                    const label = [ep.podcast, ep.number && `Ep. ${ep.number}`, ep.title].filter(Boolean).join(" · ");
                    return (
                      <div key={ep.slug} className="episode-card done">
                        <div className="episode-card-minwidth">
                          <div className="episode-card-label">
                            {label || "Untitled Episode"}
                          </div>
                          <div className="episode-card-meta">
                            {ep.slug}{ep.date ? ` · ${fmtDate(ep.date)}` : ""}{ep.links?.length ? ` · ${ep.links.length} link${ep.links.length !== 1 ? "s" : ""}` : ""}
                          </div>
                        </div>
                        <div className="episode-card-actions">
                          <button
                            onClick={async () => {
                              setPodcastName(ep.podcast || podcastName);
                              setEpisodeTitle(ep.title || "");
                              setEpisodeNumber(ep.number || "");
                              setEpisodeDate(ep.date || "");
                              const epData = await fetchEpisode(ep.slug);
                              if (epData && epData.items && epData.items.length > 0) {
                                setItems(epData.items);
                                itemsRef.current = epData.items;
                              } else {
                                setItems([]);
                                itemsRef.current = [];
                              }
                              setLinksText("");
                              setCurrentEpisodeSlug(ep.slug);
                              setActiveTab("cards");
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="episodes-view-btn"
                          >
                            View
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await deleteEpisode(ep.slug);
                                setDoneSlugs(prev => prev.filter(s => s !== ep.slug));
                                await loadEpisodes();
                              } catch (e) {
                                console.error("Delete failed:", e);
                              }
                            }}
                            className="episodes-delete-btn"
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
              <div className="episodes-empty">No episodes yet. Save a draft or generate to get started.</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
