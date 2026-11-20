# Vetta

**AI-Native Technical Recruiting Platform**

Vetta is a modern, real-world candidate evaluation and recruiting orchestration platform. It is designed to run both locally on your machine with zero configuration (using embedded WASM PostgreSQL and local or cloud LLMs) and in cloud production environments (Docker, Node servers, or serverless platforms with PostgreSQL).

---

## Key Features

- **Multi-Cloud AI Ladder**: Flexible LLM inference pipeline supporting **Groq**, **Google Gemini**, **OpenAI (GPT-4o / GPT-4o-mini)**, **local Ollama**, and **xAI** with circuit breaking and automatic failover.
- **Embedded or Cloud Database**: Zero-setup out of the box with embedded PGLite (WASM Postgres with automatic schema migrations), or full cloud Postgres via `DATABASE_URL`.
- **Standards-Compliant Auth**: Better Auth architecture supporting email/password and social OAuth providers (Google, GitHub, etc.) with secure HTTP-only cookies and session protection.
- **Resume Ingestion & Parsing**: Native PDF and DOCX resume extraction with calibrated rubrics, India market alignment embeddings, and deterministic scoring.
- **Candidate Privacy & DPDP Compliance**: Complete consent logging, retention tracking, client disclosure filtering, and full subject data erasure receipts.

---

## Quick Start (Local Development)

### Prerequisites

- Node.js 20+ (Node 22 recommended)
- npm or pnpm

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

*Note: For local testing, all keys are optional! If `DATABASE_URL` is omitted, Vetta automatically initializes an embedded in-memory PostgreSQL engine (PGLite) and auto-runs all schema migrations.*

### 3. Run Development Server

```bash
npm run dev
```

The application will start on `http://localhost:3000` (or the port specified in `PORT`).

---

## Production Build & Deployment

### Build the Application

```bash
npm run build
```

This compiles:
1. The Vite client bundle.
2. The Nitro server standalone bundle into `.output/server/index.mjs`.
3. Runs database migrations automatically if `DATABASE_URL` is configured.

### Run Production Server

```bash
node .output/server/index.mjs
```

### Docker / Container Deployment

Set the following environment variables in your container environment:

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Listening HTTP port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | *Embedded PGLite* |
| `BETTER_AUTH_SECRET` | 32+ char session signing secret | Auto-generated |
| `BETTER_AUTH_URL` | Canonical public URL (e.g. `https://vetta.yourdomain.com`) | `http://localhost:3000` |
| `OPENAI_API_KEY` | OpenAI API key | *Optional* |
| `GEMINI_API_KEY` | Google Gemini API key | *Optional* |
| `GROQ_API_KEY` | Groq API key | *Optional* |
| `OLLAMA_HOST` | Local Ollama endpoint | `http://127.0.0.1:11434` |

---

## Verification & Quality Assurance

- **Typecheck**: `npm run typecheck`
- **Lint**: `npm run lint`
- **Format**: `npm run format`

---

## Design & Content Swaps

**Two identities, one codebase.** The marketing surfaces and the product are
deliberately different:

- **Landing + intro page** (`/`): Aurora Fjord — dark cinematic `#07100F` with
  mint/ember/glacier accents, scoped to `.landing` in `src/styles.css`.
- **Software** (`/app`, `/jobs`, `/portal`, login): Midnight Black `#0B0B0C`,
  Pure White `#FFFFFF`, Lime Green `#C6F432` in a glassmorphism + soft-3D
  treatment. This is a **single locked theme — there is no light mode and no
  toggle**; the tokens live in the `:root, html.dark` block of
  `src/styles.css` and the surfaces are `.glass` / `.soft-lime` in the
  `components` layer.

**Hero background video.** Drop a ≤4 MB MP4 at `public/hero.mp4` and set
`HERO.video` in `src/shared/components/landing/content/site.ts`. It plays
muted/looping on capable desktop connections only; mobile, Save-Data and
reduced-motion visitors get `public/hero-poster.webp`, which is also the LCP
element. To change the scene, replace both files.

**All landing copy** — wordmark, headline, steps, FAQ, footer — lives in
`src/shared/components/landing/content/site.ts`. Nowhere else.

**Before launch:** replace the `TODO` placeholder stat in the hero card
(`HERO.stat`) with a real measured value, and set `VITE_PUBLIC_SITE_URL` (see
`.env.example`) so canonical links, `sitemap.xml`, `robots.txt` and the
JSON-LD blocks all point at the production host.

