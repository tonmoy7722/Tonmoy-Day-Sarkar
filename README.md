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

Email is sent through **Resend** (https://resend.com) rather than Gmail/SMTP.
Render's free tier blocks outbound SMTP ports, so a direct Gmail connection
doesn't work there — Resend sends over plain HTTPS instead, so it isn't
affected.

1. Go to https://resend.com/signup → sign up free (no card required).
2. Go to https://resend.com/api-keys → create an API key. This is your
   `RESEND_API_KEY`.
3. Set `TO_EMAIL` to **the same email address you signed up to Resend with**.
   This matters: without verifying your own domain, Resend's free sending
   address (`onboarding@resend.dev`) can only deliver to the account owner's
   own address — which is exactly what you want here, since contact messages
   should only ever go to you.
4. Free tier limits: 3,000 emails/month, 100/day — far more than a portfolio
   contact form needs.

If you later want to send from your own domain (e.g. `you@yourdomain.com`)
instead of the Resend test sender, add and verify a domain under
https://resend.com/domains, then change the `from` address in `server.js`.

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

## 4b. Publications not showing up? Check ORCID visibility

`/api/publications` only returns works that are set to **"Everyone"** visibility on
your ORCID account — this is ORCID's own rule for its public API, not something this
code controls. To check/fix:

1. Log into https://orcid.org
2. Go to your **Works** section
3. Each work has a visibility icon (eye/lock/people) — click it and set it to
   **"Everyone"**, then **Save changes**
4. Wait a minute or two, then re-test

**Debugging tools** built into the endpoint:
- `GET /api/publications?nocache=1` — bypasses the 6-hour cache, forces a fresh
  fetch from ORCID right now (use this instead of restarting the whole service
  every time you want to re-test)
- `GET /api/publications?debug=1` — returns the **raw, unfiltered** ORCID API
  response instead of the parsed list, including `groupCount` (how many works
  ORCID actually returned). If `groupCount` is 0, the problem is on ORCID's side
  (visibility) — if it's more than 0 but `publications` in the normal response is
  still empty, that points to a parsing issue, which is worth reporting.

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
| `RESEND_API_KEY` | Yes | API key from Resend (step 1) |
| `TO_EMAIL` | Yes | Where contact messages are delivered — must match your Resend account email |
| `ALLOWED_ORIGINS` | Yes | Your frontend URL(s), comma-separated (`*` while testing) |
| `DATABASE_URL` | Optional | Enables message history, tracking, admin page — use Neon, or Supabase's **Session pooler** string (not "Direct connection", which is IPv6-only and fails on Render) |
| `ADMIN_PASSWORD` | Optional | Protects `/admin` |
| `GROQ_API_KEY` | Optional | Enables the AI chat widget |
| `ORCID_ID` | Optional | Defaults to Tonmoy's ORCID already |
| `GITHUB_USERNAME` | Optional | Defaults to `tonmoy7722` already |
| `GITHUB_TOKEN` | Recommended | Avoids "GitHub API returned 403" from the shared rate limit — see `.env.example` for how to create one |

5. Deploy. Visit your Render URL — you should see `{"status":"ok",...}`.
6. Quick checks:
   - `GET /api/publications` → should return your papers pulled from ORCID (see
     section 4b above if this is empty).
   - `GET /api/github-repos` → should return your latest repos.
   - `GET /admin` → enter your admin password → should show stats + messages
     (once you've set `DATABASE_URL` and `ADMIN_PASSWORD`, and at least one
     visit/message has come in).

**Free-tier note:** the service sleeps after 15 minutes of inactivity and takes
~30-50 seconds to wake on the next request. The frontend already accounts for this
with loading states.

**Why Resend and not Gmail/SMTP:** Render disabled outbound SMTP ports for free
web services, so any Nodemailer+Gmail setup fails there with an `ETIMEDOUT`
connection error — this isn't a bug in this code, it's a platform-level block.
Resend sends over HTTPS instead, so it works fine on the free tier.

## 6. Point the frontend at it

In `index.html`, find:

```js
var API_BASE = "https://your-backend.onrender.com";
```

Set it to your real Render URL. The frontend derives every endpoint
(`/api/contact`, `/api/publications`, `/api/github-repos`, `/api/track`,
`/api/ask`) from this one base URL.

## Local development

```bash
cp .env.example .env   # fill in whichever values you're using
npm install
npm start
```

Server runs on http://localhost:3000.
