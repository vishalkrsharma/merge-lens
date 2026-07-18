# Deploying MergeLens on Render

The backend runs as a single Render Web Service backed by a Neon PostgreSQL database. No Redis is needed — the job queue uses pg-boss (PostgreSQL-backed).

> **Free tier caveats:**
> - **Web Service (free):** Spins down after 15 min of inactivity. Use a cron job (e.g. [cron-job.org](https://cron-job.org)) to ping `/api/health` every 10 min to keep it warm.
> - **PostgreSQL:** Use [Neon](https://neon.tech) (free tier) instead of Render's PostgreSQL. Neon's free tier is persistent; Render's free PostgreSQL expires after 90 days.

---

## 1. Create a Neon Database

1. Sign up at [neon.tech](https://neon.tech) and create a project
2. Copy the **Connection string** (pooled endpoint recommended)
3. This becomes your `DATABASE_URL`

---

## 2. Prepare the GitHub App Private Key

Render doesn't support file mounts on free/starter plans. Pass the PEM as an env var.

Run this locally to get a single-line version of your private key:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' keys/merge-lens-private-key.pem
```

Copy the output — you'll paste it as `GITHUB_PRIVATE_KEY` in step 4.

---

## 3. Deploy the Frontend First

The backend's `BETTER_AUTH_URL` **must point to the frontend URL** because better-auth generates GitHub OAuth callback URLs from it, and those callbacks must land on the frontend's auth proxy (`/api/auth/callback/github`), not directly on the backend.

Deploy the frontend to Vercel (or your platform of choice) first, note its URL, then proceed.

---

## 4. Create the Web Service

1. Render Dashboard → **New → Web Service**
2. Connect your `merge-lens-backend` GitHub repository
3. Configure:

| Field | Value |
|---|---|
| **Name** | `merge-lens-backend` |
| **Runtime** | Node |
| **Build Command** | `npm install -g pnpm && pnpm install && pnpm build` |
| **Start Command** | `pnpm start:prod` |
| **Release Command** | `npx prisma migrate deploy` |
| **Plan** | Free (or Starter for always-on) |

4. Under **Environment Variables**, add all variables from the table below
5. Click **Create Web Service**

---

## 5. Environment Variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string from step 1 |
| `GOOGLE_API_KEY` | Google AI Studio API key (for Gemini LLM + embeddings) |
| `GITHUB_APP_ID` | Your GitHub App numeric ID |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_WEBHOOK_SECRET` | Secret set in your GitHub App webhook config |
| `GITHUB_PRIVATE_KEY` | Single-line PEM output from step 2 |
| `BETTER_AUTH_SECRET` | A random 32+ char secret — generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | **Frontend URL** (e.g. `https://merge-lens.vercel.app`) — must be the frontend, not this backend |
| `FRONTEND_URLS` | Comma-separated allowed origins for CORS (e.g. `https://merge-lens.vercel.app`) |
| `PORT` | `10000` (Render's default port) |
| `NODE_ENV` | `production` |

> **Optional:** `OLLAMA_BASE_URL` — only needed if you want a server-side Ollama instance. Users can also set their own Ollama URL in the UI.

---

## 6. Update GitHub App Settings

After your first deploy, Render assigns a URL like `https://merge-lens-backend.onrender.com`.

1. Go to **GitHub → Settings → Developer Settings → GitHub Apps → MergeLens**
2. Update **Webhook URL** to:
   ```
   https://merge-lens-backend.onrender.com/api/webhooks/github
   ```
3. Update **Callback URL** (OAuth) to the **frontend** proxy URL:
   ```
   https://merge-lens.vercel.app/api/auth/callback/github
   ```

> The OAuth callback must point to the frontend, not the backend. The frontend proxy forwards it to the backend and ensures cookies land on the correct domain.

---

## 7. Keep-Alive Cron (Free Tier)

To prevent the free web service from spinning down and missing webhooks:

1. Go to [cron-job.org](https://cron-job.org) → create a free account
2. New cron job → URL: `https://merge-lens-backend.onrender.com/api/health`
3. Schedule: every **10 minutes**

---

## Deployment Checklist

- [ ] Neon database created and `DATABASE_URL` copied
- [ ] All environment variables set in Render
- [ ] `BETTER_AUTH_URL` points to the **frontend** URL (not the backend)
- [ ] `GITHUB_PRIVATE_KEY` set as single-line PEM
- [ ] GitHub App **Webhook URL** updated to Render backend domain
- [ ] GitHub App **Callback URL** updated to frontend proxy URL
- [ ] Keep-alive cron configured (free tier)
- [ ] Start Command confirmed as `pnpm start:prod` (not `pnpm run start` — that re-compiles TypeScript and OOMs on free tier)
- [ ] First deploy succeeded and `prisma migrate deploy` ran in release step
