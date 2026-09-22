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

## Health

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Scripts

```bash
npm run start:dev   # watch mode
npm run build       # compile
npm run lint        # oxlint
npm run test        # unit tests
npm run test:e2e    # e2e tests
```
