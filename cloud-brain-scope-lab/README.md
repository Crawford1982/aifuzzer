# Cloud Brain Scope Lab

Experimental fork of Cloud Brain for policy URL ingestion and scope planning.

This folder is intentionally separate from your base app:

- Base app: `C:\Users\Admin\Desktop\cloud brain`
- Lab app: `C:\Users\Admin\Desktop\AI-guided REST API fuzzer\cloud-brain-scope-lab`

## What is in this lab

- Normal multi-model chat.
- Scope URL analyzer endpoint: `POST /api/scope/analyze`.
- UI section to paste a policy URL and generate candidate targets / starter commands.
- Chat-native scope discussion commands with routing profiles:
  - `/scope <policy-url>` (balanced)
  - `/scope-free <policy-url>` (free-tier routing)
  - `/scope-premium <policy-url>` (premium reasoning routing)
- Router policy endpoint: `GET /api/router/policy`

## Run

1. Put your key in `.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key
```

2. Install and start:

```bash
npm install
npm run dev
```

3. Open:

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend: [http://localhost:5000](http://localhost:5000)

## Safety notes

- Treat extracted URLs as candidates, not automatic approval to probe.
- Keep low traffic defaults first (`concurrency=1`, low request count).
- Confirm in-scope assets manually before active testing.
