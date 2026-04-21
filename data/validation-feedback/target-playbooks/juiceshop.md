# Juice Shop playbook

## Start target

```powershell
docker run --rm -d --name juice-shop -p 3000:3000 bkimminich/juice-shop
```

Base URL: `http://127.0.0.1:3000`

## Prepare validation run folder

```powershell
npm run validation:new -- --target juiceshop --label baseline
```

## Run Mythos

**A — Legacy surface**

```powershell
npm start -- --target "http://127.0.0.1:3000" --scope-file "./fixtures/scope.juiceshop.local.yaml" --max-requests 400 --max-rps 8 --evidence-pack
```

**B — Minimal OpenAPI** (`fixtures/juiceshop-minimal.openapi.yaml` — `/api/Challenges`, `/rest/user/whoami`)

```powershell
npm start -- --target "http://127.0.0.1:3000" --openapi "./fixtures/juiceshop-minimal.openapi.yaml" --scope-file "./fixtures/scope.juiceshop.local.yaml" --max-requests 400 --max-rps 8 --max-body-mutations-per-op 2 --evidence-pack
```

After runs:

```powershell
npm run validation:log
```

## Stop target

```powershell
docker stop juice-shop
```
