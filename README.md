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
