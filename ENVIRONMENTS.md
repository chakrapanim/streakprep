# StreakPrep Environments (Dev → Staging → Prod)

Cloudflare Pages project **`streakprep`** has exactly two cloud environments —
**production** and **preview** — plus local dev. Each cloud env has its own D1
database and its own secrets, so staging can never touch production data.

| Tier | Where | URL | D1 database | Secrets |
|---|---|---|---|---|
| **Dev** | your machine | `http://localhost:8788` | local (miniflare) D1 | from `.dev.vars` / none |
| **Staging** | Cloudflare Pages *preview* | https://staging.streakprep.pages.dev | `streakprep-db-staging` (`bc782f3a-82c4-453e-85af-3c039d9fe95d`) | Preview tab (dashboard) |
| **Prod** | Cloudflare Pages *production* | https://streakprep.ai | `streakprep-db` (`babcd88c-…`) | Production (set via `wrangler pages secret put`) |

Config lives in `wrangler.toml`: top-level = production, `[env.preview.*]` =
staging. Both use the **same binding name** `streakprep_db`, so app code is
identical across tiers — only the underlying database differs.

## Daily workflow

### 1. Dev (local)
```bash
cd website
# one-time: seed local D1 with the schema
npx wrangler d1 execute streakprep-db --local --file=schema.sql
# run the app + functions locally with hot reload
npx wrangler pages dev
```
Local D1 is a throwaway sqlite file under `.wrangler/` — safe to wipe.
Put local-only secrets in `website/.dev.vars` (git-ignored), e.g.
`ADMIN_SECRET=devsecret`.

### 2. Staging (preview)
```bash
cd website
npx wrangler pages deploy --branch staging
```
Deploys to https://staging.streakprep.pages.dev bound to `streakprep-db-staging`.
Use this to rehearse **migrations** and **payment/webhook** changes before prod.

### 3. Production
```bash
cd website
npx wrangler pages deploy        # deploys the production branch → streakprep.ai
```

## Full-data replica (staging + dev mirror prod content)

Staging and local dev hold a **full copy of prod data** (all ~78k questions +
users/subs), so you can catch content/data bugs before prod. One caveat: the
replica schema (`schema-replica-nofk.sql`) has **foreign keys stripped** — D1
enforces FKs during bulk import and rejects the alphabetical insert order, so
the replica omits FK constraints. Data is identical; only DB-level FK
enforcement differs (the app enforces integrity in code, so app behavior
matches). Prod keeps its FKs (`schema.sql`).

### Refresh staging from prod (repeat anytime prod data changes)
```bash
cd website
# 1) export current prod data
npx wrangler d1 export streakprep-db --remote --no-schema --output=/tmp/prod_data.sql
# 2) reset staging: delete + recreate (FK-less), then load schema
npx wrangler d1 delete streakprep-db-staging -y
npx wrangler d1 create streakprep-db-staging   # copy the new database_id into wrangler.toml [env.preview]
npx wrangler d1 execute streakprep-db-staging --remote --file=schema-replica-nofk.sql
# 3) load data, then redeploy
npx wrangler d1 execute streakprep-db-staging --remote --file=/tmp/prod_data.sql --yes
npx wrangler pages deploy --branch staging --commit-dirty=true
```

### Seed local dev as a full replica
```bash
cd website
npx wrangler d1 execute streakprep-db --local --file=schema-replica-nofk.sql
npx wrangler d1 execute streakprep-db --local --file=/tmp/prod_data.sql
npx wrangler pages dev
```

## Database migrations (rehearse on staging first!)
```bash
# 1) apply to staging, verify app still works
npx wrangler d1 execute streakprep-db-staging --remote --file=migrate-0NN.sql
# 2) only then apply to production
npx wrangler d1 execute streakprep-db --remote --file=migrate-0NN.sql
```
Rebuild staging schema from prod at any time:
```bash
npx wrangler d1 export streakprep-db --remote --no-data --output=/tmp/schema.sql
npx wrangler d1 execute streakprep-db-staging --remote --file=/tmp/schema.sql
```

## Secrets
- **Production** secrets: `npx wrangler pages secret put <NAME>` (CLI targets
  production only).
- **Preview/staging** secrets: Cloudflare dashboard → Pages → `streakprep` →
  Settings → Variables and Secrets → **Preview** tab. Use **test** Razorpay
  keys and leave MSG91 unset on staging (unset MSG91 → OTP enforcement off, so
  registration works without sending real WhatsApp messages; unset Razorpay →
  checkout shows the coming-soon placeholder). This keeps staging from ever
  sending real messages or charging real cards.

## Notes / gotchas
- Staging D1 is a **full data replica** of prod (all questions + users/subs),
  refreshed via the steps above. FK constraints are stripped in the replica
  schema (see the full-data-replica section).
- Preview deployments are public by default. If you want them access-gated,
  enable Pages → Settings → “Preview deployment access”.
- The `website/` folder is its own git repo (`chakrapanim/streakprep`); the
  outer `dqi-mvp` folder is not a git repo.
