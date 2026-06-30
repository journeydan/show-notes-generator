import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EPISODES_DIR = path.join(__dirname, 'episodes');
const CRAFT_KEY_FILE = path.join(__dirname, 'craft_api_key.txt');
const CRAFT_MCP_URL = 'https://mcp.craft.do/links/7foILXddSEb/mcp';
const CRAFT_PODCAST_FOLDER = '9477946A-1CFA-454B-BDAC-7C9E0970EB61';
const PORT = 3001;

const app = express();
app.use(express.json({ limit: '5mb' }));

await fs.mkdir(EPISODES_DIR, { recursive: true });

// ─── Helpers ───

function episodeSlug(num) {
  return `episode-${String(num).padStart(3, '0')}`;
}

function episodePath(slug) {
  return path.join(EPISODES_DIR, `${slug}.md`);
}

function itemsPath(slug) {
  return path.join(EPISODES_DIR, `${slug}.items.json`);
}

async function loadItems(slug) {
  try {
    const data = await fs.readFile(itemsPath(slug), 'utf-8');
    return JSON.parse(data);
  } catch { return []; }
}

async function saveItems(slug, items) {
  if (items && items.length > 0) {
    await fs.writeFile(itemsPath(slug), JSON.stringify(items), 'utf-8');
  } else {
    // Remove items file if no items
    try { await fs.unlink(itemsPath(slug)); } catch {}
  }
}

function parseEpisodeFile(content, slug) {
  const lines = content.split('\n');
  const frontmatter = {};
  let bodyStart = 0;
  if (lines[0]?.trim() === '---') {
    let i = 1;
    while (i < lines.length && lines[i]?.trim() !== '---') {
      const colon = lines[i].indexOf(':');
      if (colon > 0) {
        const key = lines[i].slice(0, colon).trim();
        let val = lines[i].slice(colon + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        frontmatter[key] = val;
      }
      i++;
    }
    bodyStart = i + 1;
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  const links = [];
  const urlRegex = /https?:\/\/[^\s\n)]+/g;
  let match;
  while ((match = urlRegex.exec(body)) !== null) links.push(match[0]);
  return { slug, number: frontmatter.episode || '', title: frontmatter.title || '', podcast: frontmatter.podcast || '', date: frontmatter.date || '', links, body };
}

function buildEpisodeMarkdown({ number, title, podcast, date, items, sponsorText, linksText }) {
  const slug = episodeSlug(number || '000');
  let md = '---\n';
  if (podcast) md += `podcast: "${podcast}"\n`;
  if (title) md += `title: "${title}"\n`;
  if (number) md += `episode: "${number}"\n`;
  if (date) md += `date: "${date}"\n`;
  md += '---\n\n';
  if (items?.length) {
    items.filter(i => i.status === 'done').forEach((item, i) => {
      md += `## ${i + 1}. ${item.title}\n\n🔗 ${item.url}\n\n${item.summary}\n\n`;
      if (item.tags?.length) md += `*Tags: ${item.tags.join(', ')}*\n\n`;
    });
  }
  if (sponsorText) md += `---\n\n${sponsorText}\n\n`;
  if (linksText) md += `---\n\n### Pending Links\n\n${linksText}\n`;
  return { slug, markdown: md.trim() + '\n' };
}

async function callCraftMCP(method, params) {
  const key = await fs.readFile(CRAFT_KEY_FILE, 'utf-8').then(k => k.trim()).catch(() => '');
  if (!key) return null;
  const payload = { jsonrpc: '2.0', method, id: 1 };
  if (params) payload.params = params;
  const resp = await fetch(CRAFT_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) return JSON.parse(line.slice(6));
  }
  return null;
}

// ─── API Routes ───

app.get('/api/episodes', async (req, res) => {
  try {
    const files = await fs.readdir(EPISODES_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();
    const episodes = await Promise.all(
      mdFiles.map(async (file) => {
        const slug = file.replace(/\.md$/, '');
        const content = await fs.readFile(path.join(EPISODES_DIR, file), 'utf-8');
        const ep = parseEpisodeFile(content, slug);
        ep.items = await loadItems(slug);
        return ep;
      })
    );
    episodes.sort((a, b) => (parseInt(b.number) || 0) - (parseInt(a.number) || 0));
    res.json(episodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/episodes/:slug', async (req, res) => {
  try {
    const content = await fs.readFile(episodePath(req.params.slug), 'utf-8');
    const ep = parseEpisodeFile(content, req.params.slug);
    ep.items = await loadItems(req.params.slug);
    res.json(ep);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Episode not found' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/episodes', async (req, res) => {
  try {
    const { number, title, podcast, date, items, sponsorText, linksText } = req.body;
    const { slug, markdown } = buildEpisodeMarkdown({ number, title, podcast, date, items, sponsorText, linksText });
    await fs.writeFile(episodePath(slug), markdown, 'utf-8');
    await saveItems(slug, items || []);
    const content = await fs.readFile(episodePath(slug), 'utf-8');
    const ep = parseEpisodeFile(content, slug);
    ep.items = items || [];
    res.json(ep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/episodes/:slug', async (req, res) => {
  try {
    await fs.unlink(episodePath(req.params.slug));
    try { await fs.unlink(itemsPath(req.params.slug)); } catch {}
    res.json({ deleted: req.params.slug });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Episode not found' });
    res.status(500).json({ error: err.message });
  }
});

// ─── Craft Sync ───

app.post('/api/episodes/:slug/sync-to-craft', async (req, res) => {
  try {
    const content = await fs.readFile(episodePath(req.params.slug), 'utf-8');
    const ep = parseEpisodeFile(content, req.params.slug);
    ep.items = await loadItems(req.params.slug);
    const docTitle = ep.podcast ? `${ep.podcast}${ep.number ? ` · Ep. ${ep.number}` : ''}${ep.title ? `: ${ep.title}` : ''}` : `Show Notes ${ep.number ? `#${ep.number}` : ''}`;

    const createResult = await callCraftMCP('tools/call', {
      name: 'craft_write',
      arguments: { command: `documents create --title "${docTitle.replace(/"/g, '\\"')}" --folder ${CRAFT_PODCAST_FOLDER}` }
    });

    if (!createResult) {
      return res.status(500).json({ error: 'Craft sync failed: no API key configured' });
    }

    const contentText = createResult?.result?.content?.[0]?.text || '';
    const rootMatch = contentText.match(/rootBlockId: (\S+)/);
    if (!rootMatch) {
      console.error('Craft create response:', contentText);
      return res.status(500).json({ error: 'Could not parse Craft response', raw: contentText });
    }

    const rootBlockId = rootMatch[1];
    const bodyMarkdown = ep.body;
    await callCraftMCP('tools/call', {
      name: 'craft_write',
      arguments: { command: `blocks add --id ${rootBlockId} --markdown "${bodyMarkdown.replace(/"/g, '\\"')}"` }
    });

    res.json({ success: true, docTitle, rootBlockId });
  } catch (err) {
    res.status(500).json({ error: `Craft sync failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Show Notes API running on http://localhost:${PORT}`);
});
