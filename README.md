# KATAGOGE

Weekly accountability and internal communication system. Each Monday every team member submits three things: what they did last week, what they will do this week, and what's blocking them. Founders get a control plane on top — submission tracking, blocker board, broadcast comms, and admin.

Old-school internal tool aesthetic. No flashy gradients. Built to be used, not photographed.

## Stack

- **React 18 + Vite** (single-page app, no SSR needed)
- **Supabase** — Postgres + email-OTP auth + RLS
- **Cloudflare Pages** — frontend hosting (free, commercial use allowed, unlimited bandwidth)
- **Resend** (optional but recommended) — SMTP for auth emails so you don't hit Supabase's 2-emails/hour built-in limit

Total cost on the free path: **$0/month**. See `DEPLOYMENT.md`.

## Quick start (local dev)

```bash
npm install
cp .env.example .env.local       # fill in your Supabase URL + anon key
npm run dev
```

You also need to:
1. Run `supabase/schema.sql` in your Supabase project's SQL editor
2. Edit `supabase/seed-founder.sql` with your real email + name and run it
3. Sign in at the running app with that email — Supabase emails you a 6-digit code

Full setup steps in `DEPLOYMENT.md`.

## Project structure

```
.
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx           — React entry
│   ├── App.jsx            — entire UI (auth, dashboards, admin)
│   ├── styles.css         — minimal globals
│   └── lib/
│       ├── supabase.js    — Supabase client setup
│       └── db.js          — typed query layer (camelCase ↔ snake_case)
├── supabase/
│   ├── schema.sql         — tables, indexes, RLS policies, auth trigger
│   └── seed-founder.sql   — bootstrap your first founder(s)
└── .github/workflows/
    └── keep-alive.yml     — daily ping so Supabase free tier doesn't pause
```

## How auth works

Both founders and team members sign in the same way — email + 6-digit code from Supabase. There are no passwords. Role (founder vs team) lives in the `profiles` table.

You **invite** people by adding their email + name + role to the `profiles` table:
- Founders: edit `seed-founder.sql` and run it once (or use Admin → Founders inside the app later)
- Team members: from the running app, Admin → Team Members → + Add Member

When someone signs in for the first time, a Postgres trigger links their auth account to their pre-existing profile by email. People who haven't been invited see a clear rejection message instead of getting access.

## Smart features beyond the spec

- Streak counter (consecutive on-time weeks per person)
- Carry-over detection (warns when "this week's plan" looks like last week's plan)
- Blocker board with aging buckets — Fresh / Aging / Stale columns
- Submission heatmap — 8 weeks per person, at-a-glance pattern of slippage
- Read receipts on broadcast messages with a progress bar
- Live message preview side-by-side while composing
- One-click "message this user" from any blocker (pre-fills with the blocker quoted)

## License

Internal tool. Yours to do with as you like.
