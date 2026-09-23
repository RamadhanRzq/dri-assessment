import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { ApiExceptionFilter } from './../src/shared/errors/api-exception.filter.js';
import { DatabaseService } from './../src/shared/database/database.service.js';

/**
 * Runs against automotive_marketplace_test. The Vitest config injects
 * DATABASE_URL from .env.test into process.env, which beats Nest's fallback
 * to .env — otherwise these tests would delete development rows.
 */
describe('Listings (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;

  const valid = {
    make: 'Toyota',
    model: 'Avanza',
    year: 2021,
    mileage: 35_000,
    price: 210_000_000,
    condition: 'used',
    transmission: 'manual',
    fuelType: 'petrol',
    color: 'Silver',
    location: 'Jakarta',
  };

  const create = (overrides: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/listings')
      .send({ ...valid, ...overrides });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    db = app.get(DatabaseService);
  });

  beforeEach(async () => {
    // Identity is not reset, so ids grow across tests; assertions never assume
    // them. Attribute values cascade with the listings they belong to.
    await db.query('DELETE FROM listings');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /listings', () => {
    it('creates a listing with defaults', async () => {
      const res = await create().expect(201);

      expect(res.body).toMatchObject({
        make: 'Toyota',
        model: 'Avanza',
        fuelType: 'petrol',
        images: [],
        status: 'available',
      });
      expect(res.body.id).toBeGreaterThan(0);
    });

    it('rejects an invalid payload with a validation envelope', async () => {
      const res = await create({ year: 1800, price: -5, condition: 'broken' }).expect(400);

      expect(res.body.error.code).toBe('bad_request');
      expect(res.body.error.message).toBe('Validation failed');
      expect(res.body.error.details.join(' ')).toContain('year');
    });

    it('strips an unknown field instead of storing it', async () => {
      const res = await create({ bogus: 'x' }).expect(201);
      expect(res.body.bogus).toBeUndefined();
    });
  });

  describe('GET /listings/:id', () => {
    it('returns an existing listing', async () => {
      const { body: created } = await create().expect(201);

      const res = await request(app.getHttpServer())
        .get(`/listings/${created.id}`)
        .expect(200);
      expect(res.body.id).toBe(created.id);
    });

    it('returns 404 with the error envelope for a missing listing', async () => {
      const res = await request(app.getHttpServer()).get('/listings/999999').expect(404);

      expect(res.body.error.code).toBe('not_found');
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(app.getHttpServer()).get('/listings/abc').expect(400);
    });
  });

  describe('PATCH /listings/:id', () => {
    it('updates only the supplied fields', async () => {
      const { body: created } = await create().expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/listings/${created.id}`)
        .send({ price: 195_000_000, status: 'pending' })
        .expect(200);

      expect(res.body.price).toBe(195_000_000);
      expect(res.body.status).toBe('pending');
      expect(res.body.make).toBe(created.make);
      expect(res.body.model).toBe(created.model);
    });

    it('returns 404 for a missing listing', async () => {
      await request(app.getHttpServer())
        .patch('/listings/999999')
        .send({ price: 1 })
        .expect(404);
    });
  });

  describe('DELETE /listings/:id', () => {
    it('soft deletes by setting status to removed and keeps the row', async () => {
      const { body: created } = await create().expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/listings/${created.id}`)
        .expect(200);
      expect(res.body.status).toBe('removed');

      const [row] = await db.query<{ count: number }>(
        'SELECT count(*)::bigint AS count FROM listings WHERE id = $1',
        [created.id],
      );
      expect(row.count).toBe(1);
    });
  });

  describe('GET /listings', () => {
    it('hides removed listings unless explicitly requested', async () => {
      await create({ make: 'Keep' }).expect(201);
      const { body: gone } = await create({ make: 'Gone' }).expect(201);
      await request(app.getHttpServer()).delete(`/listings/${gone.id}`).expect(200);

      const visible = await request(app.getHttpServer()).get('/listings').expect(200);
      expect(visible.body.data.map((l: { make: string }) => l.make)).toEqual(['Keep']);
      expect(visible.body.pagination.total).toBe(1);

      const removed = await request(app.getHttpServer())
        .get('/listings?status=removed')
        .expect(200);
      expect(removed.body.data.map((l: { make: string }) => l.make)).toEqual(['Gone']);
    });

    it('combines multiple filters', async () => {
      await create({ make: 'A', fuelType: 'petrol', location: 'Jakarta', price: 100 }).expect(201);
      await create({ make: 'B', fuelType: 'diesel', location: 'Jakarta', price: 100 }).expect(201);
      await create({ make: 'C', fuelType: 'petrol', location: 'Bali', price: 100 }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/listings?fuelType=petrol&location=jakarta')
        .expect(200);

      expect(res.body.data.map((l: { make: string }) => l.make)).toEqual(['A']);
    });

    it('matches make and location case-insensitively', async () => {
      await create({ make: 'Toyota', location: 'Jakarta' }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/listings?make=toyota&location=JAKARTA')
        .expect(200);

      expect(res.body.pagination.total).toBe(1);
    });

    it('rejects a contradictory range', async () => {
      const res = await request(app.getHttpServer())
        .get('/listings?minPrice=500&maxPrice=100')
        .expect(400);
      expect(res.body.error.message).toBe('minPrice must not exceed maxPrice');
    });

    it('rejects an unknown sort key', async () => {
      await request(app.getHttpServer()).get('/listings?sort=dropTable').expect(400);
    });

    it('rejects a tampered cursor', async () => {
      const res = await request(app.getHttpServer())
        .get('/listings?cursor=@@@not-a-cursor@@@')
        .expect(400);
      expect(res.body.error.message).toBe('Invalid cursor');
    });

    it('rejects a cursor issued for a different sort', async () => {
      await create({ price: 1 }).expect(201);
      await create({ price: 2 }).expect(201);

      const first = await request(app.getHttpServer())
        .get('/listings?limit=1&sort=price')
        .expect(200);
      const cursor = first.body.pagination.nextCursor;
      expect(typeof cursor).toBe('string');

      await request(app.getHttpServer())
        .get(`/listings?limit=1&sort=year&cursor=${cursor}`)
        .expect(400);
    });
  });

  describe('cursor pagination', () => {
    /** Inserts rows directly so created_at ordering is fully controlled. */
    const seed = async (count: number, createdAt?: string) => {
      await db.query(
        `INSERT INTO listings
           (make, model, year, mileage, price, condition, transmission,
            fuel_type, color, location, created_at)
         SELECT 'Seed' || g, 'X', 2020, 1000, 100000000, 'used', 'manual',
                'petrol', 'Red', 'Jakarta',
                COALESCE($2::timestamptz, now()) + (g || ' seconds')::interval
           FROM generate_series(1, $1) g`,
        [count, createdAt ?? null],
      );
    };

    const walk = async (query: string) => {
      const ids: number[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const url = cursor ? `${query}&cursor=${cursor}` : query;
        const res = await request(app.getHttpServer()).get(url).expect(200);
        ids.push(...res.body.data.map((l: { id: number }) => l.id));
        cursor = res.body.pagination.nextCursor;
        pages += 1;
        if (pages > 20) throw new Error('pagination did not terminate');
      } while (cursor);

      return { ids, pages };
    };

    it('returns an empty first page without a cursor', async () => {
      const res = await request(app.getHttpServer()).get('/listings').expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toMatchObject({ hasMore: false, nextCursor: null, total: 0 });
    });

    it('walks every row exactly once across pages', async () => {
      await seed(7);

      const { ids, pages } = await walk('/listings?limit=3');

      expect(ids).toHaveLength(7);
      expect(new Set(ids).size).toBe(7);
      expect(pages).toBe(3);
    });

    it('does not repeat or skip rows that share one ordering value', async () => {
      // Same created_at for every row: only the id tie-breaker separates them.
      await db.query(
        `INSERT INTO listings
           (make, model, year, mileage, price, condition, transmission,
            fuel_type, color, location, created_at)
         SELECT 'Tie' || g, 'X', 2020, 1000, 100000000, 'used', 'manual',
                'petrol', 'Red', 'Jakarta', timestamptz '2026-01-01 00:00:00+00'
           FROM generate_series(1, 9) g`,
      );

      const { ids } = await walk('/listings?limit=2&sort=createdAt&order=desc');

      expect(ids).toHaveLength(9);
      expect(new Set(ids).size).toBe(9);
    });

    it('paginates correctly when timestamps differ below millisecond precision', async () => {
      // Date#toISOString() would collapse these into one value and drop rows.
      await db.query(
        `INSERT INTO listings
           (make, model, year, mileage, price, condition, transmission,
            fuel_type, color, location, created_at)
         SELECT 'Micro' || g, 'X', 2020, 1000, 100000000, 'used', 'manual',
                'petrol', 'Red', 'Jakarta',
                timestamptz '2026-01-01 00:00:00.123456+00' + (g || ' microseconds')::interval
           FROM generate_series(1, 6) g`,
      );

      const { ids } = await walk('/listings?limit=2&sort=createdAt&order=desc');

      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
    });

    it('keeps the page stable when a row is inserted after the first page', async () => {
      await seed(6);

      const first = await request(app.getHttpServer())
        .get('/listings?limit=3&sort=createdAt&order=desc')
        .expect(200);
      const firstIds = first.body.data.map((l: { id: number }) => l.id);

      // A newer row would shift every offset-based page; keyset must ignore it.
      await seed(1, '2030-01-01T00:00:00Z');

      const rest = await walk(
        `/listings?limit=3&sort=createdAt&order=desc&cursor=${first.body.pagination.nextCursor}`,
      );

      expect(rest.ids).toHaveLength(3);
      for (const id of rest.ids) expect(firstIds).not.toContain(id);
    });

    it('carries the filters into every page', async () => {
      await db.query(
        `INSERT INTO listings
           (make, model, year, mileage, price, condition, transmission,
            fuel_type, color, location)
         SELECT CASE WHEN g % 2 = 0 THEN 'Even' ELSE 'Odd' END, 'X', 2020,
                1000, 100000000, 'used', 'manual', 'petrol', 'Red', 'Jakarta'
           FROM generate_series(1, 8) g`,
      );

      const { ids } = await walk('/listings?limit=2&make=Even');

      expect(ids).toHaveLength(4);
      const rows = await db.query<{ make: string }>(
        `SELECT make FROM listings WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      expect(rows.every((row) => row.make === 'Even')).toBe(true);
    });
  });
});
