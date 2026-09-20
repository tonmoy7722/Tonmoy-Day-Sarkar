# Portfolio Backend

Backend for Tonmoy Day Sarkar's portfolio. Handles:

1. **Contact form** — emails you when someone submits it (always on)
2. **Message history** — stores every contact submission in a database (optional)
3. **Visit / CV-download tracking** — counts page views and CV downloads (optional)
4. **Publications feed** — pulls your papers live from ORCID (always on, no key needed)
5. **GitHub projects feed** — pulls your latest repos live from GitHub (always on, no key needed)
6. **Admin page** at `/admin` — password-protected view of messages + stats (optional)
7. **"Ask about Tonmoy" AI chat** — visitors can ask questions, answered by a free LLM (optional)

Features marked "optional" only activate once you set their environment
variable. Everything else keeps working if you skip them.

---

## 1. Contact form email (required)

Same as before:

1. Go to https://myaccount.google.com/security → turn on **2-Step Verification**.
2. Go to https://myaccount.google.com/apppasswords → create an app password.
3. Copy the 16-character password (remove spaces) → this is `EMAIL_PASS`.

## 2. Database — for message history, tracking, and admin (optional but recommended)

Pick one, both are free and take under 2 minutes to set up:

**Option A — Neon** (recommended, simplest)
1. Go to https://neon.tech → sign up free (no credit card).
2. Create a project. On the dashboard, copy the **connection string** — it looks like
   `postgres://user:password@ep-xxxx.neon.tech/dbname?sslmode=require`.
3. This is your `DATABASE_URL`.

**Option B — Supabase**
1. Go to https://supabase.com → sign up free.
2. Create a project → Settings → Database → copy the **Connection string** (URI mode).
3. This is your `DATABASE_URL`.

The backend automatically creates the two tables it needs (`messages`, `visits`) the
first time it starts up — no manual SQL required.

## 3. Admin page password (optional)

Set `ADMIN_PASSWORD` to any password you choose. This protects `/admin` and the
`/api/admin/*` routes. If you skip this, the admin page just shows "wrong password"
forever — nothing is exposed.

## 4. AI chat — "Ask about Tonmoy" (optional)

1. Go to https://console.groq.com → sign up free.
2. Create an API key.
3. Set it as `GROQ_API_KEY`.

Groq's free tier is generous (enough for a portfolio's traffic) and fast. If you skip
this, the chat widget on the frontend will show "chat is not configured yet."

## 5. Deploy to Render

1. Push this `portfolio-backend` folder to its own GitHub repo (or a subfolder of an
   existing repo, using Render's "Root Directory" setting).
2. On Render: **New +** → **Web Service** → connect the repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free is fine to start.
4. Under **Environment**, add whichever of these you're using:

| Variable | Required? | Purpose |
|---|---|---|
| `EMAIL_USER` | Yes | Gmail address that sends notifications |
| `EMAIL_PASS` | Yes | App password from step 1 |
| `TO_EMAIL` | Yes | Where contact messages are delivered |
| `ALLOWED_ORIGINS` | Yes | Your frontend URL(s), comma-separated (`*` while testing) |
| `DATABASE_URL` | Optional | Enables message history, tracking, admin page |
| `ADMIN_PASSWORD` | Optional | Protects `/admin` |
| `GROQ_API_KEY` | Optional | Enables the AI chat widget |
| `ORCID_ID` | Optional | Defaults to Tonmoy's ORCID already |
| `GITHUB_USERNAME` | Optional | Defaults to `tonmoy7722` already |

5. Deploy. Visit your Render URL — you should see `{"status":"ok",...}`.
6. Quick checks:
   - `GET /api/publications` → should return your papers pulled from ORCID.
   - `GET /api/github-repos` → should return your latest repos.
   - `GET /admin` → enter your admin password → should show stats + messages
     (once you've set `DATABASE_URL` and `ADMIN_PASSWORD`, and at least one
     visit/message has come in).

**Free-tier note:** the service sleeps after 15 minutes of inactivity and takes
~30-50 seconds to wake on the next request. The frontend already accounts for this
with loading states.

## 6. Point the frontend at it

In `index.html`, find:

```js
var CONTACT_API_URL = "https://your-backend.onrender.com/api/contact";
```

The frontend derives the other endpoints (`/api/publications`, `/api/github-repos`,
`/api/track`, `/api/ask`) from the same base URL automatically — you only need to
set this one line.

## Local development

```bash
cp .env.example .env   # fill in whichever values you're using
npm install
npm start
```

Server runs on http://localhost:3000.
