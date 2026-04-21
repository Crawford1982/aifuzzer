# DVGA playbook

## Start target

```powershell
docker run --rm -d --name dvga -p 5013:5013 -e WEB_HOST=0.0.0.0 -e WEB_PORT=5013 dolevf/dvga
```

Base URL: `http://127.0.0.1:5013` (use numeric host — Mythos rejects bare `localhost` as a target hostname)

## Prepare validation run folder

```powershell
npm run validation:new -- --target dvga --label baseline
```

## Run Mythos

**A — Legacy surface (no OpenAPI)**

```powershell
npm start -- --target "http://127.0.0.1:5013" --scope-file "./fixtures/scope.dvga.local.yaml" --max-requests 300 --max-rps 8 --evidence-pack
```

**B — OpenAPI-backed `/graphql` POST** (minimal spec: `fixtures/dvga-graphql.openapi.yaml`)

```powershell
npm start -- --target "http://127.0.0.1:5013" --openapi "./fixtures/dvga-graphql.openapi.yaml" --scope-file "./fixtures/scope.dvga.local.yaml" --max-requests 300 --max-rps 8 --max-body-mutations-per-op 3 --evidence-pack
```

**C — Stub typed plan** (jsonplaceholder-shaped paths — expect 404 on DVGA; useful for compiler/executor smoke)

```powershell
npm start -- --target "http://127.0.0.1:5013" --stub-plan --scope-file "./fixtures/scope.dvga.local.yaml" --max-requests 120 --max-rps 8 --evidence-pack
```

After any run:

```powershell
npm run validation:log
```

## Stop target

```powershell
docker stop dvga
```
