# Automotive Marketplace API

Production-oriented REST API for an automotive marketplace: vehicle listings, hierarchical categories, dynamic filter attributes, full-text and faceted search.

## Tech Stack

- **Runtime**: Node.js + NestJS + TypeScript
- **Database**: PostgreSQL (raw SQL / query builder — no ORM)
- **Testing**: Vitest + Supertest
- **Lint/Format**: oxlint + Prettier

## Setup

```bash
npm install
cp .env.example .env
createdb automotive_marketplace
npm run migrate
npm run start:dev
```

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production` | `development` |
| `PORT` | HTTP port (≥ 1) | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `CORS_ORIGIN` | Comma-separated allowed origins | — (CORS off) |

Validated at boot — invalid values fail fast with a descriptive error.

## Database

Schema changes live in `src/shared/database/migrations/` as plain SQL and are
applied by a small forward-only runner. Applied files are recorded in
`schema_migrations`, so re-running is a no-op and a failed migration rolls back
completely.

```bash
npm run migrate         # apply pending migrations to DATABASE_URL
npm run migrate:test    # apply to the test database (.env.test)
```

## Seed Data

```bash
npm run seed            # reset and insert 500 listings
npm run seed 50         # reset and insert 50 listings
```

The seeder truncates `listings` and inserts the requested number of rows in
batches. Values come from a fixed-seed PRNG, so the same command always produces
the same rows; only `images` URLs are derived from the row index. It refuses to
run when `NODE_ENV=production`.

## Health

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":12.3,"timestamp":"...","database":"up"}
```

Returns `503` when the database is unreachable, so an orchestrator can stop
routing traffic instead of letting requests fail as `500`s.

## API

Interactive documentation is served from the running app:

| URL | Contents |
| --- | --- |
| `/docs` | Swagger UI |
| `/docs-json` | OpenAPI 3 document |

### Listings

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/listings` | Create a listing |
| `GET` | `/listings` | Browse with filters, sorting, cursor pagination |
| `GET` | `/listings/:id` | Get a single listing |
| `PATCH` | `/listings/:id` | Update a listing |
| `DELETE` | `/listings/:id` | Soft delete (`status = removed`) |

Create:

```bash
curl -X POST http://localhost:3000/listings \
  -H 'Content-Type: application/json' \
  -d '{
    "make": "Toyota", "model": "Avanza", "year": 2021,
    "mileage": 35000, "price": 210000000,
    "condition": "used", "transmission": "manual", "fuelType": "petrol",
    "color": "Silver", "location": "Jakarta",
    "images": ["https://cdn.example.com/a.jpg"]
  }'
```

Browse:

```bash
curl 'http://localhost:3000/listings?fuelType=petrol&location=jakarta&minPrice=100000000&limit=20&sort=price&order=asc'
```

```json
{
  "data": [{ "id": 1, "make": "Toyota", "price": 195000000, "...": "..." }],
  "pagination": {
    "limit": 20,
    "hasMore": true,
    "total": 42,
    "nextCursor": "WzEsInByaWNlIiwyNjUwMDAwMDAsM10"
  }
}
```

Supported query parameters:

| Parameter | Notes |
| --- | --- |
| `make`, `model`, `location` | Case-insensitive exact match |
| `minPrice`, `maxPrice` | IDR, inclusive |
| `yearFrom`, `yearTo` | Inclusive |
| `minMileage`, `maxMileage` | Inclusive |
| `condition` | `new` \| `used` \| `certified` |
| `transmission` | `manual` \| `automatic` \| `cvt` |
| `fuelType` | `petrol` \| `diesel` \| `electric` \| `hybrid` |
| `status` | Defaults to every status except `removed` |
| `sort` | `createdAt` \| `price` \| `year` \| `mileage` |
| `order` | `asc` \| `desc` |
| `limit` | 1–100, default 20 |
| `cursor` | Opaque; from `pagination.nextCursor` |

### Errors

Every failure uses one envelope, so clients never branch on two shapes:

```json
{ "error": { "code": "not_found", "message": "Listing 42 not found" } }
```

Validation failures add a `details` array naming each offending field.

### Categories

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/categories` | Full tree, nested by parent |
| `GET` | `/categories/:id` | Category with its direct children |
| `GET` | `/categories/:id/listings` | Listings in the category and its descendants |
| `POST` | `/categories` | Create a node |
| `PATCH` | `/categories/:id` | Rename |

Listings carry an optional `categoryId`. Filtering by a category includes every
descendant, and `GET /categories/:id/listings` exposes the same page scoped to a
subtree.

## Category Tree Strategy

Categories use a **materialised path** (`ltree`), not a parent-pointer-only
table.

The path is built from slugs (`cars.suv.5-seater`), so it is known at INSERT
time from the parent's path and needs no trigger or second pass. A CHECK
constraint ties the path to the node it describes: the last label must equal the
node's slug and `nlevel(path)` must equal its depth, so a stored path cannot
disagree with the tree.

Why `ltree` over a plain text path column with `text_pattern_ops`: on a 156-node,
4-level tree, descendant and ancestor lookups measured the same (~0.12 ms), so
performance did not decide it. `ltree` won on the model — the database rejects a
malformed path instead of storing it, ancestry is one operator (`path <@
'cars.suv'`) rather than a `LIKE` plus an equality case for the node itself, and
moving a subtree is `subpath()` over the descendants rather than string surgery
on every stored path.

Why not adjacency-list-only: recursive CTEs answer descendant queries but cannot
use an index for the recursion, so filtering listings by category would rescan
the tree on every request.

Category-scoped queries resolve the subtree as `category_id = ANY(ARRAY(SELECT …
WHERE path <@ …))`. Written as `IN (subquery)` the planner used a semi-join,
scanned the whole active index, and filtered afterwards — 35 ms on 50k rows
versus 0.17 ms for the array form, which the planner can use as an index
condition.

## Indexing Strategy

`listings` carries three index families, each tied to a query shape:

| Family | Serves |
| --- | --- |
| `listings_active_*` (partial, `WHERE status <> 'removed'`) | Default browse, one per sort key |
| `listings_status_*` (`status, <sort>, id`) | Explicit `status=` filters, including `removed` |
| `listings_{make,model,location}_lower_idx` | Combined equality filters on those columns |

The partial family exists because the default browse predicate is an inequality.
`(status, created_at, id)` can only serve `status = ?`, so the planner fell back
to a sequential scan plus a top-N sort — on 50k rows that was 869 buffers and
~11 ms to return 21 rows, growing with table size. A partial index matching the
predicate gives an index-only scan at ~0.1 ms, and it still serves
`status='available'`/`pending`/`sold`; `status='removed'` is the one case the
partial index excludes, which the `listings_status_*` family covers.

`fuel_type`, `condition`, and `transmission` are deliberately **not** indexed.
With 3–4 distinct values an equality filter still matches a fifth of the table,
so the planner consistently preferred the sort index with a filter; `EXPLAIN`
produced identical plans with and without them. Migration `0002` drops them.

## Pagination Strategy

`GET /listings` uses keyset (cursor) pagination, not `OFFSET`.

The cursor encodes `[version, sortKey, sortValue, id]` as base64url. It carries
the sort key so a cursor cannot be reused against a different ordering, and the
`id` because a sort column alone is not a total order — rows sharing a price
would have an undefined position and could repeat or be skipped. The query
compares the tuple lexicographically (`(price, id) < ($1, $2)`), which matches
the composite indexes and keeps deep pages as cheap as the first.

`created_at` cursors carry Postgres' full microsecond text form rather than a
JavaScript `Date`: `Date` only holds milliseconds, and truncating would re-serve
the boundary row on the next page.

## Error Handling

`ApiExceptionFilter` renders every failure through one envelope and maps
Postgres SQLSTATE codes to the status they actually mean (`23505` → `409`,
`23514` → `400`), instead of leaking constraint violations as `500`s.

## Docker

The image is multi-stage: `npm ci` + `nest build` in the builder, then a
production-only `npm ci --omit=dev` runtime. The migration runner and its `.sql`
files are copied in because the runner reads them from disk at runtime, so a
release can migrate itself without shipping the source tree.

```bash
docker build -t dri-assessment .
docker run --rm -e DATABASE_URL=postgresql://... dri-assessment \
  node src/shared/database/migrate.ts
docker run --rm -p 3000:3000 -e DATABASE_URL=postgresql://... dri-assessment
```

## CI/CD

`.github/workflows/deploy.yml` runs two jobs:

| Job | Trigger | Steps |
| --- | --- | --- |
| `quality` | every push and PR | `npm ci`, `npm run lint`, `npm run migrate:test`, `npm run test:e2e` against a `postgres:17` service container |
| `publish` | pushes to `main` only | builds the image and pushes it to GHCR |

The image is published to `ghcr.io/<owner>/dri-assessment` with three tags:
the branch name, `sha-<full-commit>`, and `latest` (default branch only).
It authenticates with the built-in `GITHUB_TOKEN` — no extra secret is needed,
and the repository name is lowercased because GHCR rejects uppercase owners.

Pushing an image is where the workflow stops: pulling and running it is the
deployment platform's job.

```bash
docker pull ghcr.io/<owner>/dri-assessment:latest
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://... -e NODE_ENV=production \
  ghcr.io/<owner>/dri-assessment:latest
```

## Docker Compose (VPS)

`docker-compose.yml` runs the whole stack on one host: PostgreSQL, a one-shot
migration job, then the API.

```bash
cp .env.example .env     # then set POSTGRES_PASSWORD
docker compose up -d
docker compose logs -f api
```

| Service | Role |
| --- | --- |
| `db` | `postgres:17`, data on the `pgdata` volume, `pg_isready` healthcheck |
| `migrate` | runs the migration runner once, then exits |
| `api` | the image, published on `${API_PORT:-3000}`, polls `/health` |

Ordering is enforced by dependencies, not by sleep loops: `api` waits for
`db` to be healthy and for `migrate` to exit 0, so a fresh host never serves an
unmigrated schema. Re-running `up` re-runs `migrate`, which is a no-op once
`schema_migrations` is current.

Compose substitutes `${...}` from `.env`, but each service receives only the
variables listed under its own `environment` — the whole file is not injected.
`DATABASE_URL` is defined once via the `x-database-url` anchor, so the password
lives in one place.

| Variable | Purpose | Default |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | database password; **required**, no default | — |
| `POSTGRES_USER` | database user | `spc` |
| `POSTGRES_DB` | database name | `automotive_marketplace` |
| `API_PORT` | host port for the API | `3000` |
| `IMAGE` | image to run | `ghcr.io/<owner>/dri-assessment:latest` |
| `CORS_ORIGIN` | comma-separated allowed origins | empty (CORS off) |

`build: .` is present next to `image:`, so the same file works two ways:
`docker compose up -d --build` builds locally from the checkout, while a host
without the source just pulls `IMAGE`. Nothing is exposed except the API port;
PostgreSQL stays on the internal network.

The API container runs as the non-root `node` user. The image's `EXPOSE 3000`
is informational — `PORT` and the published port are what the API actually
binds.

Seeding is deliberately not a compose service: the seeder truncates tables and
refuses to run when `NODE_ENV=production`, which the image sets. Run it as a
one-off against the same database, clearing `NODE_ENV` for that single run:

```bash
docker compose run --rm --no-deps -e NODE_ENV= migrate \
  node src/shared/database/seed.ts 500
```

It reuses the `migrate` service because that one already carries `DATABASE_URL`
and the copied seed script, and `--no-deps` keeps it from restarting the stack.
Nothing seeds on `up`, so a restart never wipes the database.

## Scripts

```bash
npm run start:dev   # watch mode
npm run build       # compile
npm run lint        # oxlint
npm run test        # unit tests
npm run test:e2e    # e2e tests (uses .env.test)
npm run migrate     # apply migrations
npm run seed        # reset and seed listings
```
