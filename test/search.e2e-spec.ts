import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { AttributeQueryPipe } from './../src/modules/listings/attribute-query.pipe.js';
import { ApiExceptionFilter } from './../src/shared/errors/api-exception.filter.js';
import { DatabaseService } from './../src/shared/database/database.service.js';

/**
 * Search, facets, and autocomplete. Runs against automotive_marketplace_test;
 * DATABASE_URL comes from .env.test via the Vitest config.
 */
describe('Search & filters (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;

  /** Category ids, resolved per test because identities are not reset. */
  let cars: number;
  let suv: number;
  let motorcycles: number;

  const attributeIds: Record<string, number> = {};

  const get = (url: string) => request(app.getHttpServer()).get(url);

  /** Inserts a listing directly so the fixture does not depend on the API. */
  const listing = async (overrides: Record<string, unknown> = {}): Promise<number> => {
    const row = {
      make: 'Toyota',
      model: 'Avanza',
      year: 2021,
      mileage: 35_000,
      price: 210_000_000,
      condition: 'used',
      transmission: 'manual',
      fuel_type: 'petrol',
      color: 'Silver',
      location: 'Jakarta',
      status: 'available',
      category_id: null as number | null,
      ...overrides,
    };

    const rows = await db.query<{ id: number }>(
      `INSERT INTO listings
         (make, model, year, mileage, price, condition, transmission,
          fuel_type, color, location, status, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        row.make,
        row.model,
        row.year,
        row.mileage,
        row.price,
        row.condition,
        row.transmission,
        row.fuel_type,
        row.color,
        row.location,
        row.status,
        row.category_id,
      ],
    );
    return rows[0].id;
  };

  const setAttribute = async (
    listingId: number,
    key: string,
    value: string | number | boolean,
  ): Promise<void> => {
    const column =
      typeof value === 'boolean' ? 'value_bool' : typeof value === 'number' ? 'value_num' : 'value_text';
    await db.query(
      `INSERT INTO listing_attribute_values (listing_id, attribute_id, ${column})
       VALUES ($1, $2, $3)`,
      [listingId, attributeIds[key], value],
    );
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts: the attribute pipe must run before validation, otherwise
    // `attr.*` parameters are stripped as unknown properties.
    app.useGlobalPipes(
      new AttributeQueryPipe(),
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    db = app.get(DatabaseService);
  });

  beforeEach(async () => {
    await db.query('DELETE FROM listings');
    await db.query('DELETE FROM attributes');
    await db.query('DELETE FROM categories');

    const createCategory = async (name: string, slug: string, parentId: number | null) => {
      const path = parentId === null ? slug : `${(await db.query<{ path: string }>('SELECT path::text AS path FROM categories WHERE id = $1', [parentId]))[0].path}.${slug}`;
      const depth = parentId === null ? 1 : 2;
      const rows = await db.query<{ id: number }>(
        `INSERT INTO categories (parent_id, name, slug, path, depth)
         VALUES ($1, $2, $3, $4::ltree, $5) RETURNING id`,
        [parentId, name, slug, path, depth],
      );
      return rows[0].id;
    };

    cars = await createCategory('Cars', 'cars', null);
    suv = await createCategory('SUV', 'suv', cars);
    motorcycles = await createCategory('Motorcycles', 'motorcycles', null);

    // Definitions are global rows attached to categories, mirroring the seed.
    const defineAttribute = async (
      key: string,
      type: 'enum' | 'range' | 'boolean',
      categories: number[],
      options: string[] = [],
    ) => {
      const rows = await db.query<{ id: number }>(
        `INSERT INTO attributes (key, label, type, options)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [key, key, type, options],
      );
      attributeIds[key] = rows[0].id;
      for (const categoryId of categories) {
        await db.query(
          'INSERT INTO category_attributes (category_id, attribute_id) VALUES ($1, $2)',
          [categoryId, rows[0].id],
        );
      }
    };

    await defineAttribute('fuel_type', 'enum', [cars, motorcycles], [
      'petrol',
      'diesel',
      'electric',
    ]);
    await defineAttribute('engine_capacity', 'range', [cars, motorcycles]);
    await defineAttribute('seat_count', 'range', [cars]);
    await defineAttribute('is_negotiable', 'boolean', [cars, motorcycles]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /listings/search', () => {
    it('matches make, model, and location', async () => {
      await listing({ make: 'Toyota', model: 'Avanza', location: 'Jakarta' });
      await listing({ make: 'Honda', model: 'Brio', location: 'Bandung' });

      const byMake = await get('/listings/search?q=toyota').expect(200);
      expect(byMake.body.pagination.total).toBe(1);
      expect(byMake.body.data[0].make).toBe('Toyota');

      const byModel = await get('/listings/search?q=avanza').expect(200);
      expect(byModel.body.pagination.total).toBe(1);

      const byCity = await get('/listings/search?q=bandung').expect(200);
      expect(byCity.body.pagination.total).toBe(1);
      expect(byCity.body.data[0].location).toBe('Bandung');
    });

    it('is case-insensitive and stems nothing', async () => {
      await listing({ make: 'Toyota' });
      const res = await get('/listings/search?q=TOYOTA').expect(200);
      expect(res.body.pagination.total).toBe(1);
    });

    it('combines the text query with column filters', async () => {
      await listing({ make: 'Toyota', fuel_type: 'petrol', price: 100_000_000 });
      await listing({ make: 'Toyota', fuel_type: 'diesel', price: 100_000_000 });
      await listing({ make: 'Honda', fuel_type: 'petrol', price: 100_000_000 });

      const res = await get('/listings/search?q=toyota&fuelType=petrol').expect(200);

      expect(res.body.pagination.total).toBe(1);
      expect(res.body.data[0].fuel_type).toBeUndefined();
      expect(res.body.data[0].fuelType).toBe('petrol');
    });

    it('hides removed listings from search', async () => {
      await listing({ make: 'Toyota', status: 'removed' });
      await listing({ make: 'Toyota' });

      const res = await get('/listings/search?q=toyota').expect(200);
      expect(res.body.pagination.total).toBe(1);
    });

    it('orders by relevance by default and honours an explicit sort', async () => {
      await listing({ make: 'Toyota', model: 'Avanza', price: 300 });
      await listing({ make: 'Toyota', model: 'Avanza', price: 100 });

      const relevant = await get('/listings/search?q=toyota').expect(200);
      expect(relevant.body.pagination.nextCursor).toBeNull();

      const byPrice = await get('/listings/search?q=toyota&sort=price&order=asc').expect(200);
      expect(byPrice.body.data.map((l: { price: number }) => l.price)).toEqual([100, 300]);
    });

    it('paginates with a cursor without repeating rows', async () => {
      for (let i = 0; i < 5; i += 1) await listing({ make: 'Toyota', model: `M${i}` });

      const first = await get('/listings/search?q=toyota&limit=2').expect(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.pagination.total).toBe(5);

      const second = await get(
        `/listings/search?q=toyota&limit=2&cursor=${first.body.pagination.nextCursor}`,
      ).expect(200);

      const firstIds = first.body.data.map((l: { id: number }) => l.id);
      for (const row of second.body.data) expect(firstIds).not.toContain(row.id);
    });

    it('returns an empty page when nothing matches', async () => {
      await listing({ make: 'Toyota' });

      const res = await get('/listings/search?q=zzzz').expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toMatchObject({ total: 0, hasMore: false, nextCursor: null });
    });
  });

  describe('attribute filters', () => {
    it('filters by an enum attribute', async () => {
      const petrol = await listing({ make: 'A' });
      const diesel = await listing({ make: 'B' });
      await setAttribute(petrol, 'fuel_type', 'petrol');
      await setAttribute(diesel, 'fuel_type', 'diesel');

      const res = await get('/listings/search?attr.fuel_type=petrol').expect(200);
      expect(res.body.pagination.total).toBe(1);
      expect(res.body.data[0].attributes.fuel_type).toBe('petrol');
    });

    it('filters by a numeric range attribute', async () => {
      const big = await listing({ make: 'A' });
      const small = await listing({ make: 'B' });
      await setAttribute(big, 'engine_capacity', 2500);
      await setAttribute(small, 'engine_capacity', 1200);

      const lower = await get('/listings/search?attr.engine_capacity.min=2000').expect(200);
      expect(lower.body.pagination.total).toBe(1);
      expect(lower.body.data[0].attributes.engine_capacity).toBe(2500);

      const bounded = await get(
        '/listings/search?attr.engine_capacity.min=1000&attr.engine_capacity.max=2000',
      ).expect(200);
      expect(bounded.body.pagination.total).toBe(1);
      expect(bounded.body.data[0].attributes.engine_capacity).toBe(1200);
    });

    it('filters by a boolean attribute', async () => {
      const yes = await listing({ make: 'A' });
      const no = await listing({ make: 'B' });
      await setAttribute(yes, 'is_negotiable', true);
      await setAttribute(no, 'is_negotiable', false);

      const res = await get('/listings/search?attr.is_negotiable=true').expect(200);
      expect(res.body.pagination.total).toBe(1);
      expect(res.body.data[0].attributes.is_negotiable).toBe(true);
    });

    it('combines attribute filters with column filters', async () => {
      const match = await listing({ make: 'Toyota', price: 100 });
      const wrongMake = await listing({ make: 'Honda', price: 100 });
      const wrongPrice = await listing({ make: 'Toyota', price: 900 });
      for (const id of [match, wrongMake, wrongPrice]) await setAttribute(id, 'fuel_type', 'petrol');

      const res = await get('/listings/search?make=Toyota&maxPrice=500&attr.fuel_type=petrol').expect(200);
      expect(res.body.pagination.total).toBe(1);
      expect(res.body.data[0].id).toBe(match);
    });

    it('rejects an unknown attribute key', async () => {
      const res = await get('/listings/search?attr.nope=1').expect(400);
      expect(res.body.error.message).toContain("Unknown filter attribute 'nope'");
    });

    it('rejects a value the enum does not allow', async () => {
      const res = await get('/listings/search?attr.fuel_type=coal').expect(400);
      expect(res.body.error.message).toContain("does not allow 'coal'");
    });

    it('rejects a non-numeric bound on a range attribute', async () => {
      const res = await get('/listings/search?attr.engine_capacity.min=abc').expect(400);
      expect(res.body.error.message).toContain('numeric bound');
    });

    it('rejects a range whose min exceeds its max', async () => {
      const res = await get('/listings/search?attr.engine_capacity.min=3000&attr.engine_capacity.max=100').expect(400);
      expect(res.body.error.message).toContain('min must not exceed max');
    });

    it('rejects a non-boolean value for a boolean attribute', async () => {
      const res = await get('/listings/search?attr.is_negotiable=maybe').expect(400);
      expect(res.body.error.message).toContain('true or false');
    });
  });

  describe('GET /filters', () => {
    it('counts every facet value in the current context', async () => {
      await listing({ make: 'Toyota', fuel_type: 'petrol', location: 'Jakarta' });
      await listing({ make: 'Toyota', fuel_type: 'diesel', location: 'Bandung' });
      await listing({ make: 'Honda', fuel_type: 'petrol', location: 'Jakarta' });

      const res = await get('/filters').expect(200);

      expect(res.body.total).toBe(3);
      const make = res.body.facets.find((f: { key: string }) => f.key === 'make');
      expect(make.values).toEqual([
        { value: 'Toyota', count: 2 },
        { value: 'Honda', count: 1 },
      ]);
      expect(res.body.price).toMatchObject({ min: 210_000_000, max: 210_000_000, count: 3 });
      expect(res.body.year).toMatchObject({ min: 2021, max: 2021, count: 3 });
    });

    it('narrows counts to the current filters', async () => {
      const toyotaPetrol = await listing({ make: 'Toyota' });
      const toyotaDiesel = await listing({ make: 'Toyota' });
      const hondaPetrol = await listing({ make: 'Honda' });
      await setAttribute(toyotaPetrol, 'fuel_type', 'petrol');
      await setAttribute(toyotaDiesel, 'fuel_type', 'diesel');
      await setAttribute(hondaPetrol, 'fuel_type', 'petrol');

      const res = await get('/filters?make=Toyota').expect(200);

      expect(res.body.total).toBe(2);
      const fuel = res.body.attributes.find((a: { key: string }) => a.key === 'fuel_type');
      // Honda's petrol listing is filtered out, so only Toyota's two count.
      expect(fuel.count).toBe(2);
      expect(fuel.values).toContainEqual({ value: 'petrol', count: 1 });
      expect(fuel.values).toContainEqual({ value: 'diesel', count: 1 });
      expect(fuel.values).toContainEqual({ value: 'electric', count: 0 });
    });

    it('keeps a facet count equal to the number of rows that filter returns', async () => {
      await listing({ make: 'Toyota' });
      await listing({ make: 'Toyota' });
      await listing({ make: 'Honda' });

      const facets = await get('/filters').expect(200);
      const toyota = facets.body.facets
        .find((f: { key: string }) => f.key === 'make')
        .values.find((v: { value: string }) => v.value === 'Toyota');

      const search = await get('/listings/search?make=Toyota').expect(200);

      expect(toyota.count).toBe(search.body.pagination.total);
    });

    it('excludes removed listings from every count', async () => {
      await listing({ make: 'Toyota' });
      await listing({ make: 'Toyota', status: 'removed' });

      const res = await get('/filters').expect(200);
      expect(res.body.total).toBe(1);
    });

    it('reports observed bounds for a range attribute', async () => {
      const low = await listing({ make: 'A' });
      const high = await listing({ make: 'B' });
      await setAttribute(low, 'engine_capacity', 1100);
      await setAttribute(high, 'engine_capacity', 3000);

      const res = await get('/filters').expect(200);
      const capacity = res.body.attributes.find((a: { key: string }) => a.key === 'engine_capacity');

      expect(capacity).toMatchObject({ type: 'range', min: 1100, max: 3000, count: 2 });
    });

    it('counts each enum value that listings actually carry', async () => {
      const a = await listing({ make: 'A' });
      const b = await listing({ make: 'B' });
      await setAttribute(a, 'fuel_type', 'petrol');
      await setAttribute(b, 'fuel_type', 'petrol');

      const res = await get('/filters').expect(200);
      const fuel = res.body.attributes.find((a: { key: string }) => a.key === 'fuel_type');

      expect(fuel.values).toContainEqual({ value: 'petrol', count: 2 });
      // An option nobody selected still appears, with a zero count.
      expect(fuel.values).toContainEqual({ value: 'diesel', count: 0 });
    });

    it('accepts the same filters as search, including attributes', async () => {
      const match = await listing({ make: 'Toyota' });
      const other = await listing({ make: 'Honda' });
      await setAttribute(match, 'fuel_type', 'petrol');
      await setAttribute(other, 'fuel_type', 'diesel');

      const res = await get('/filters?attr.fuel_type=petrol').expect(200);
      expect(res.body.total).toBe(1);
    });
  });

  describe('GET /filters/:categoryId', () => {
    it('returns the attributes a category exposes', async () => {
      const res = await get(`/filters/${cars}`).expect(200);

      expect(res.body.map((a: { key: string }) => a.key).sort()).toEqual([
        'engine_capacity',
        'fuel_type',
        'is_negotiable',
        'seat_count',
      ]);
    });

    it('inherits the attributes of ancestors', async () => {
      const res = await get(`/filters/${suv}`).expect(200);
      const keys = res.body.map((a: { key: string }) => a.key);

      // Defined on Cars, visible on its child.
      expect(keys).toContain('seat_count');
      expect(keys).toContain('engine_capacity');
    });

    it('does not leak attributes from a sibling branch', async () => {
      const res = await get(`/filters/${motorcycles}`).expect(200);
      const keys = res.body.map((a: { key: string }) => a.key);

      // seat_count is attached to Cars only.
      expect(keys).not.toContain('seat_count');
      expect(keys).toContain('engine_capacity');
    });

    it('describes each attribute type and its options', async () => {
      const res = await get(`/filters/${cars}`).expect(200);

      const fuel = res.body.find((a: { key: string }) => a.key === 'fuel_type');
      expect(fuel).toMatchObject({ type: 'enum' });
      expect(fuel.options).toEqual(['petrol', 'diesel', 'electric']);

      const capacity = res.body.find((a: { key: string }) => a.key === 'engine_capacity');
      expect(capacity).toMatchObject({ type: 'range', options: [] });

      const negotiable = res.body.find((a: { key: string }) => a.key === 'is_negotiable');
      expect(negotiable).toMatchObject({ type: 'boolean' });
    });

    it('returns 404 for an unknown category', async () => {
      const res = await get('/filters/999999').expect(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('GET /listings/search/suggest', () => {
    it('suggests makes, models, and cities by prefix', async () => {
      await listing({ make: 'Toyota', model: 'Avanza', location: 'Jakarta' });
      await listing({ make: 'Toyota', model: 'Innova', location: 'Bandung' });

      const makes = await get('/listings/search/suggest?q=toy').expect(200);
      expect(makes.body.data).toEqual([{ type: 'make', value: 'Toyota', count: 2 }]);

      const models = await get('/listings/search/suggest?q=av').expect(200);
      expect(models.body.data).toContainEqual({ type: 'model', value: 'Avanza', count: 1 });

      const cities = await get('/listings/search/suggest?q=band').expect(200);
      expect(cities.body.data).toContainEqual({ type: 'location', value: 'Bandung', count: 1 });
    });

    it('matches case-insensitively', async () => {
      await listing({ make: 'Toyota' });

      const res = await get('/listings/search/suggest?q=TOY').expect(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('ranks by how many listings carry the value', async () => {
      await listing({ make: 'Honda', model: 'Civic' });
      await listing({ make: 'Honda', model: 'City' });
      await listing({ make: 'Honda', model: 'City' });

      const res = await get('/listings/search/suggest?q=ci').expect(200);
      expect(res.body.data[0]).toEqual({ type: 'model', value: 'City', count: 2 });
    });

    it('respects the limit', async () => {
      for (const model of ['Civic', 'City', 'Creta', 'Calya']) await listing({ make: 'Honda', model });

      const res = await get('/listings/search/suggest?q=c&limit=2').expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
    });

    it('scopes suggestions to a category', async () => {
      await listing({ make: 'Toyota', category_id: cars });
      await listing({ make: 'Toyota', category_id: motorcycles });

      const res = await get(`/listings/search/suggest?q=toy&categoryId=${cars}`).expect(200);
      expect(res.body.data).toEqual([{ type: 'make', value: 'Toyota', count: 1 }]);
    });

    it('excludes removed listings', async () => {
      await listing({ make: 'Toyota' });
      await listing({ make: 'Toyota', status: 'removed' });

      const res = await get('/listings/search/suggest?q=toy').expect(200);
      expect(res.body.data).toEqual([{ type: 'make', value: 'Toyota', count: 1 }]);
    });

    it('treats a wildcard character literally', async () => {
      await listing({ make: 'Toyota' });

      const res = await get('/listings/search/suggest?q=%25').expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('rejects a missing or empty query', async () => {
      await get('/listings/search/suggest').expect(400);
      await get('/listings/search/suggest?q=').expect(400);
    });
  });

  describe('attribute values on listings', () => {
    it('stores values supplied at creation and returns them', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .send({
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
          categoryId: cars,
          attributes: { fuel_type: 'petrol', engine_capacity: 1500, is_negotiable: true },
        })
        .expect(201);

      expect(res.body.attributes).toEqual({
        fuel_type: 'petrol',
        engine_capacity: 1500,
        is_negotiable: true,
      });

      const fetched = await get(`/listings/${res.body.id}`).expect(200);
      expect(fetched.body.attributes.engine_capacity).toBe(1500);
    });

    it('rejects an attribute the category does not define', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .send({
          make: 'Honda',
          model: 'Vario',
          year: 2021,
          mileage: 10_000,
          price: 20_000_000,
          condition: 'used',
          transmission: 'automatic',
          fuelType: 'petrol',
          color: 'Red',
          location: 'Jakarta',
          categoryId: motorcycles,
          attributes: { seat_count: 5 },
        })
        .expect(400);

      expect(res.body.error.message).toContain("Unknown filter attribute 'seat_count'");
    });

    it('rejects a value of the wrong type', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .send({
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
          categoryId: cars,
          attributes: { engine_capacity: 'big' },
        })
        .expect(400);

      expect(res.body.error.message).toContain('numeric');
    });

    it('updates and clears individual values without touching the rest', async () => {
      const { body: created } = await request(app.getHttpServer())
        .post('/listings')
        .send({
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
          categoryId: cars,
          attributes: { fuel_type: 'petrol', engine_capacity: 1500, is_negotiable: true },
        })
        .expect(201);

      const patched = await request(app.getHttpServer())
        .patch(`/listings/${created.id}`)
        .send({ attributes: { engine_capacity: 2000, is_negotiable: null } })
        .expect(200);

      expect(patched.body.attributes).toEqual({ fuel_type: 'petrol', engine_capacity: 2000 });
    });

    it('checks an attribute update against the listing category, not the request', async () => {
      const { body: created } = await request(app.getHttpServer())
        .post('/listings')
        .send({
          make: 'Honda',
          model: 'Vario',
          year: 2021,
          mileage: 10_000,
          price: 20_000_000,
          condition: 'used',
          transmission: 'automatic',
          fuelType: 'petrol',
          color: 'Red',
          location: 'Jakarta',
          categoryId: motorcycles,
          attributes: { engine_capacity: 150 },
        })
        .expect(201);

      // seat_count belongs to Cars; the listing is in Motorcycles.
      await request(app.getHttpServer())
        .patch(`/listings/${created.id}`)
        .send({ attributes: { seat_count: 5 } })
        .expect(400);
    });
  });
});
