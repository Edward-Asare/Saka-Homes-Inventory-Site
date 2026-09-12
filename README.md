# Saka Homes Inventory

Inventory dashboard for Saka Homes: live stock tracking, purchase orders, reporting, and user management. The app is a React frontend served by an Express API that stores data in PostgreSQL.

## Prerequisites

- **Node.js** 20 or later
- **npm** (comes with Node.js)
- **PostgreSQL** 14 or later, running locally or hosted (Supabase, Neon, Render, Cloud SQL)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in values:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Set at least these variables in `.env`:

   | Variable | Required | Notes |
   | --- | --- | --- |
   | `DATABASE_URL` | Yes | PostgreSQL connection string, e.g. `postgresql://USER:PASSWORD@localhost:5432/saka_homes` |
   | `INITIAL_ADMIN_USERNAME` | Yes (first run) | Creates the first admin if none exists |
   | `INITIAL_ADMIN_PASSWORD` | Yes (first run) | Minimum 12 characters; you must change it on first login |
   | `JWT_SECRET` | Recommended | 32+ characters. Required in production. Locally, a random secret is generated if unset (sessions reset on restart) |

   Optional:

   | Variable | Notes |
   | --- | --- |
   | `INITIAL_ADMIN_NAME` | Display name for the first admin |
   | `INITIAL_GUEST_USERNAME` / `INITIAL_GUEST_PASSWORD` / `INITIAL_GUEST_NAME` | Creates a guest account if that username does not exist (password min 8 characters) |
   | `PORT` | Defaults to `3000` |
   | `MANAGER_WHATSAPP_E164` / `MANAGER_WHATSAPP_DISPLAY` | WhatsApp contact for guest material requisitions (E.164 digits only, e.g. `233XXXXXXXXX`) |
   | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Optional Supabase client config |
   | `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_JWT_SECRET` | Optional server-side Supabase auth |

   Instead of `DATABASE_URL`, you can use `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`.

## Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Tables are created automatically on startup. Log in with the initial admin credentials from `.env`.

Health check: [http://localhost:3000/api/health](http://localhost:3000/api/health)

## Production

```bash
npm run build
npm start
```

In production you must set `NODE_ENV=production` and a strong `JWT_SECRET` (or `SUPABASE_JWT_SECRET`) of at least 32 characters. The first admin is required if the database has no admin yet.

Set `CORS_ORIGIN` to a comma-separated allow-list of origins if the API is served from a different host. Leave it unset for same-origin only.

## Other scripts

| Command | Purpose |
| --- | --- |
| `npm run lint` | Typecheck with `tsc --noEmit` |
| `npm run security:check` | Run the security regression script |
| `npm run preview` | Vite preview of the frontend only (API is not included) |
