import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EPISODES_DIR = path.join(__dirname, 'episodes');
const PORT = 3001;

const app = express();
app.use(express.json({ limit: '5mb' }));

// Ensure episodes directory exists
await fs.mkdir(EPISODES_DIR, { recursive: true });

// ─── Helpers ───

function episodeSlug(num) {
  const padded = String(num).padStart(3, '0');
  return `episode-${padded}`;
}

function episodeFilename(slug) {
  return `${slug}.md`;
}

function episodePath(slug) {
  return path.join(EPISODES_DIR, episodeFilename(slug));
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
  while ((match = urlRegex.exec(body)) !== null) {
    links.push(match[0]);
  }

  return {
    slug,
    number: frontmatter.episode || '',
    title: frontmatter.title || '',
    podcast: frontmatter.podcast || '',
    date: frontmatter.date || '',
    links,
    body,
  };
}

function buildEpisodeMarkdown({ number, title, podcast, date, items, sponsorText, linksText }) {
  const slug = episodeSlug(number || '000');
  let md = '---\n';
  if (podcast) md += `podcast: "${podcast}"\n`;
  if (title) md += `title: "${title}"\n`;
  if (number) md += `episode: "${number}"\n`;
  if (date) md += `date: "${date}"\n`;
  md += '---\n\n';

  if (items && items.length > 0) {
    items.filter(i => i.status === 'done').forEach((item, i) => {
      md += `## ${i + 1}. ${item.title}\n\n`;
      md += `🔗 ${item.url}\n\n`;
      md += `${item.summary}\n\n`;
      if (item.tags?.length) md += `*Tags: ${item.tags.join(', ')}*\n\n`;
    });
  }

  if (sponsorText) {
    md += `---\n\n${sponsorText}\n\n`;
  }

  if (linksText) {
    md += `---\n\n### Pending Links\n\n${linksText}\n`;
  }

  return { slug, markdown: md.trim() + '\n' };
}

// ─── API Routes ───

// List all episode files
app.get('/api/episodes', async (req, res) => {
  try {
    const files = await fs.readdir(EPISODES_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();

    const episodes = await Promise.all(
      mdFiles.map(async (file) => {
        const content = await fs.readFile(path.join(EPISODES_DIR, file), 'utf-8');
        const slug = file.replace(/\.md$/, '');
        return parseEpisodeFile(content, slug);
      })
    );

    // Sort by episode number descending
    episodes.sort((a, b) => {
      const na = parseInt(a.number) || 0;
      const nb = parseInt(b.number) || 0;
      return nb - na;
    });

    res.json(episodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single episode by slug
app.get('/api/episodes/:slug', async (req, res) => {
  try {
    const filePath = episodePath(req.params.slug);
    const content = await fs.readFile(filePath, 'utf-8');
    res.json(parseEpisodeFile(content, req.params.slug));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Episode not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Save an episode (create or update)
app.post('/api/episodes', async (req, res) => {
  try {
    const { number, title, podcast, date, items, sponsorText, linksText } = req.body;
    const { slug, markdown } = buildEpisodeMarkdown({ number, title, podcast, date, items, sponsorText, linksText });
    const filePath = episodePath(slug);
    await fs.writeFile(filePath, markdown, 'utf-8');
    const content = await fs.readFile(filePath, 'utf-8');
    res.json(parseEpisodeFile(content, slug));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an episode
app.delete('/api/episodes/:slug', async (req, res) => {
  try {
    const filePath = episodePath(req.params.slug);
    await fs.unlink(filePath);
    res.json({ deleted: req.params.slug });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Episode not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Show Notes API running on http://localhost:${PORT}`);
});
