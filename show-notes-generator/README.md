# Show Notes Generator

An AI-powered tool that summarizes your curated links into formatted podcast show notes and newsletter copy.

## Setup

### 1. Get an Anthropic API Key
Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.

### 2. Install dependencies
```bash
npm install
```

### 3. Run locally
```bash
npm run dev
```

Without an API key set in the environment, the app will show a field where you can paste your key at runtime.

---

## Deploy to Vercel (recommended)

### Option A — Vercel Dashboard (easiest)
1. Push this folder to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo
3. Under **Environment Variables**, add:
   - Name: `VITE_ANTHROPIC_API_KEY`
   - Value: your `sk-ant-...` key
4. Click **Deploy**

Your app will be live at `https://your-project.vercel.app`

### Option B — Vercel CLI
```bash
npm install -g vercel
vercel
```
Then add the environment variable in the Vercel dashboard under your project's Settings → Environment Variables.

---

## Project structure

```
show-notes-generator/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    └── App.jsx
```

## Notes
- The API key is stored as an environment variable (`VITE_ANTHROPIC_API_KEY`) and never exposed in the UI when set this way.
- If no env var is set, users will see an API key input field at the top of the app — useful for local/personal use.
- The app uses Claude's web search tool to fetch and summarize each URL.
