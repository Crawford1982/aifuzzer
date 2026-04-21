# crAPI playbook

## Start target

```powershell
mkdir ".lab" -ErrorAction SilentlyContinue
git clone --depth 1 https://github.com/OWASP/crAPI.git ".lab/crapi"
docker compose -f ".lab/crapi/deploy/docker/docker-compose.yml" pull
docker compose -f ".lab/crapi/deploy/docker/docker-compose.yml" up -d
```

Repository clone lives under **`.lab/crapi`** (listed in **`.gitignore`** — local lab only).

If **`docker compose pull`** fails with TLS / timeout, retry later or use the upstream **prebuilt compose** flow from [crAPI README](https://github.com/OWASP/crAPI/blob/main/README.md).

Base URL: `http://127.0.0.1:8888`

## Prepare validation run folder

```powershell
npm run validation:new -- --target crapi --label baseline
```

## Run Mythos

**A — Legacy surface**

```powershell
npm start -- --target "http://127.0.0.1:8888" --scope-file "./fixtures/scope.crapi.local.yaml" --max-requests 500 --max-rps 8 --evidence-pack
```

**B — Minimal OpenAPI** (`fixtures/crapi-minimal.openapi.yaml` — uses **`GET /workshop/api/shop/orders/all`** for the list; bare **`GET …/orders`** can **500** on some builds — see validation run notes.)

```powershell
npm start -- --target "http://127.0.0.1:8888" --openapi "./fixtures/crapi-minimal.openapi.yaml" --scope-file "./fixtures/scope.crapi.local.yaml" --max-requests 500 --max-rps 8 --max-body-mutations-per-op 2 --evidence-pack
```

Cross-user / tenant checks: when you have **two JWTs**, add **`--auth`** / **`--auth-alt`** per root **`README.md`** (see **`docs/VALIDATION-TRIAGE.md`**).

### Get a JWT for `--auth-env` (PowerShell)

Creates a **throwaway** user, logs in, runs Mythos in the **same** session so **`MYTHOS_CRAPI_JWT`** is set (never commit tokens; **`output/`** reports contain `replayCurl` — keep gitignored).

```powershell
$base = "http://127.0.0.1:8888"
$email = "mythos-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + "@example.com"
$pwd = "YourTempPass!9"
Invoke-RestMethod -Uri "$base/identity/api/auth/signup" -Method POST `
  -Body (@{ name="Bench"; email=$email; number="5551112222"; password=$pwd } | ConvertTo-Json) `
  -ContentType "application/json"
$login = Invoke-RestMethod -Uri "$base/identity/api/auth/login" -Method POST `
  -Body (@{ email=$email; password=$pwd } | ConvertTo-Json) -ContentType "application/json"
$env:MYTHOS_CRAPI_JWT = $login.token
npm start -- --target "http://127.0.0.1:8888" --openapi "./fixtures/crapi-minimal.openapi.yaml" `
  --scope-file "./fixtures/scope.crapi.local.yaml" --auth-env MYTHOS_CRAPI_JWT `
  --max-requests 500 --max-rps 8 --max-body-mutations-per-op 2 --evidence-pack
```

After runs:

```powershell
npm run validation:log
```

## Stop target

```powershell
docker compose -f ".lab/crapi/deploy/docker/docker-compose.yml" down
```
