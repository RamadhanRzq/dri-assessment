import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { ApiExceptionFilter } from './../src/shared/errors/api-exception.filter.js';
import { DatabaseService } from './../src/shared/database/database.service.js';

/** Runs against automotive_marketplace_test; DATABASE_URL comes from .env.test. */
describe('Categories (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/categories').send(body);

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
    // listings holds the FK, so clear the link before the tree.
    await db.query('UPDATE listings SET category_id = NULL');
    await db.query('DELETE FROM categories');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /categories', () => {
    it('creates a root at depth 1 with a path equal to its slug', async () => {
      const res = await post({ name: 'Cars', slug: 'cars' }).expect(201);

      expect(res.body).toMatchObject({ name: 'Cars', slug: 'cars', path: 'cars', depth: 1 });
      expect(res.body.parentId).toBeNull();
    });

    it('derives a child path and depth from its parent', async () => {
      const { body: root } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      const res = await post({ name: 'SUV', slug: 'suv', parentId: root.id }).expect(201);

      expect(res.body).toMatchObject({ path: 'cars.suv', depth: 2, parentId: root.id });
    });

    it('supports arbitrary depth', async () => {
      const { body: a } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      const { body: b } = await post({ name: 'SUV', slug: 'suv', parentId: a.id }).expect(201);
      const { body: c } = await post({ name: '5-Seater', slug: '5-seater', parentId: b.id }).expect(201);
      const { body: d } = await post({ name: 'Luxury', slug: 'luxury', parentId: c.id }).expect(201);

      expect(d).toMatchObject({ path: 'cars.suv.5-seater.luxury', depth: 4 });
    });

    it('rejects a duplicate slug among siblings', async () => {
      const { body: root } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      await post({ name: 'SUV', slug: 'suv', parentId: root.id }).expect(201);

      const res = await post({ name: 'SUV Again', slug: 'suv', parentId: root.id }).expect(409);
      expect(res.body.error.code).toBe('conflict');
    });

    it('allows the same slug in a different branch', async () => {
      const { body: cars } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      const { body: bikes } = await post({ name: 'Motorcycles', slug: 'motorcycles' }).expect(201);
      await post({ name: 'SUV', slug: 'suv', parentId: cars.id }).expect(201);
      await post({ name: 'SUV', slug: 'suv', parentId: bikes.id }).expect(201);

      const res = await request(app.getHttpServer()).get('/categories').expect(200);
      const flat = JSON.stringify(res.body);
      expect(flat).toContain('cars.suv');
      expect(flat).toContain('motorcycles.suv');
    });

    it('returns 404 for an unknown parent', async () => {
      const res = await post({ name: 'Orphan', slug: 'orphan', parentId: 999999 }).expect(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('rejects an invalid slug', async () => {
      const res = await post({ name: 'Bad', slug: 'Not A Slug' }).expect(400);
      expect(res.body.error.details.join(' ')).toContain('slug');
    });
  });

  describe('GET /categories', () => {
    it('returns the tree nested by parent', async () => {
      const { body: cars } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      const { body: suv } = await post({ name: 'SUV', slug: 'suv', parentId: cars.id }).expect(201);
      await post({ name: '5-Seater', slug: '5-seater', parentId: suv.id }).expect(201);
      await post({ name: 'Motorcycles', slug: 'motorcycles' }).expect(201);

      const res = await request(app.getHttpServer()).get('/categories').expect(200);

      expect(res.body).toHaveLength(2);
      const roots = res.body.map((c: { slug: string }) => c.slug).sort();
      expect(roots).toEqual(['cars', 'motorcycles']);

      const carsNode = res.body.find((c: { slug: string }) => c.slug === 'cars');
      expect(carsNode.children[0].slug).toBe('suv');
      expect(carsNode.children[0].children[0].slug).toBe('5-seater');
    });

    it('returns an empty array when there are no categories', async () => {
      const res = await request(app.getHttpServer()).get('/categories').expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /categories/:id', () => {
    it('returns the category with its direct children only', async () => {
      const { body: cars } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      const { body: suv } = await post({ name: 'SUV', slug: 'suv', parentId: cars.id }).expect(201);
      await post({ name: '5-Seater', slug: '5-seater', parentId: suv.id }).expect(201);

      const res = await request(app.getHttpServer()).get(`/categories/${cars.id}`).expect(200);

      expect(res.body.slug).toBe('cars');
      expect(res.body.children).toHaveLength(1);
      expect(res.body.children[0].slug).toBe('suv');
      // The grandchild belongs to the child, not to this node.
      expect(res.body.children[0].children).toBeUndefined();
    });

    it('returns 404 for an unknown id', async () => {
      const res = await request(app.getHttpServer()).get('/categories/999999').expect(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('PATCH /categories/:id', () => {
    it('renames a category', async () => {
      const { body: root } = await post({ name: 'Cars', slug: 'cars' }).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/categories/${root.id}`)
        .send({ name: 'Automobiles' })
        .expect(200);

      expect(res.body.name).toBe('Automobiles');
      expect(res.body.path).toBe('cars');
    });

    it('rewrites the path of descendants when the slug changes', async () => {
      const { body: cars } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      const { body: suv } = await post({ name: 'SUV', slug: 'suv', parentId: cars.id }).expect(201);
      await post({ name: '5-Seater', slug: '5-seater', parentId: suv.id }).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/categories/${suv.id}`)
        .send({ slug: 'suvs' })
        .expect(200);
      expect(res.body.path).toBe('cars.suvs');

      const child = await request(app.getHttpServer())
        .get(`/categories/${suv.id}`)
        .expect(200);
      expect(child.body.children[0].path).toBe('cars.suvs.5-seater');
    });

    it('rejects renaming onto a sibling slug', async () => {
      const { body: cars } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      await post({ name: 'SUV', slug: 'suv', parentId: cars.id }).expect(201);
      const { body: sedan } = await post({ name: 'Sedan', slug: 'sedan', parentId: cars.id }).expect(201);

      await request(app.getHttpServer())
        .patch(`/categories/${sedan.id}`)
        .send({ slug: 'suv' })
        .expect(409);
    });
  });

  describe('category-scoped listings', () => {
    /** Three listings: two under Cars > SUV, one under Motorcycles. */
    const seedScoped = async () => {
      const { body: cars } = await post({ name: 'Cars', slug: 'cars' }).expect(201);
      const { body: suv } = await post({ name: 'SUV', slug: 'suv', parentId: cars.id }).expect(201);
      const { body: five } = await post({ name: '5-Seater', slug: '5-seater', parentId: suv.id }).expect(201);
      const { body: bikes } = await post({ name: 'Motorcycles', slug: 'motorcycles' }).expect(201);

      const mk = (make: string, categoryId: number) =>
        request(app.getHttpServer())
          .post('/listings')
          .send({
            make,
            model: 'X',
            year: 2021,
            mileage: 1000,
            price: 100_000_000,
            condition: 'used',
            transmission: 'manual',
            fuelType: 'petrol',
            color: 'Red',
            location: 'Jakarta',
            categoryId,
          })
          .expect(201);

      await mk('UnderFive', five.id);
      await mk('UnderSuv', suv.id);
      await mk('UnderBikes', bikes.id);

      return { cars, suv, five, bikes };
    };

    it('stores and returns the category on a listing', async () => {
      const { five } = await seedScoped();

      const res = await request(app.getHttpServer())
        .get('/listings?categoryId=' + five.id)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].categoryId).toBe(five.id);
    });

    it('includes descendants when filtering by a parent category', async () => {
      const { cars } = await seedScoped();

      const res = await request(app.getHttpServer())
        .get(`/listings?categoryId=${cars.id}`)
        .expect(200);

      const makes = res.body.data.map((l: { make: string }) => l.make).sort();
      // Both SUV listings, at different depths under Cars; not the motorcycle.
      expect(makes).toEqual(['UnderFive', 'UnderSuv']);
    });

    it('scopes to a single leaf without pulling in siblings', async () => {
      const { five } = await seedScoped();

      const res = await request(app.getHttpServer())
        .get(`/listings?categoryId=${five.id}`)
        .expect(200);
      expect(res.body.data.map((l: { make: string }) => l.make)).toEqual(['UnderFive']);
    });

    it('combines a category filter with other filters', async () => {
      const { cars } = await seedScoped();

      const matching = await request(app.getHttpServer())
        .get(`/listings?categoryId=${cars.id}&fuelType=petrol`)
        .expect(200);
      expect(matching.body.data).toHaveLength(2);

      const empty = await request(app.getHttpServer())
        .get(`/listings?categoryId=${cars.id}&fuelType=diesel`)
        .expect(200);
      expect(empty.body.data).toHaveLength(0);
      expect(empty.body.pagination.total).toBe(0);
    });

    it('leaves a listing uncategorised when no category is given', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .send({
          make: 'Loose',
          model: 'X',
          year: 2021,
          mileage: 1,
          price: 1,
          condition: 'used',
          transmission: 'manual',
          fuelType: 'petrol',
          color: 'Red',
          location: 'Jakarta',
        })
        .expect(201);

      expect(res.body.categoryId).toBeNull();
    });

    it('serves the same page through GET /categories/:id/listings', async () => {
      const { cars, bikes } = await seedScoped();

      const res = await request(app.getHttpServer())
        .get(`/categories/${cars.id}/listings`)
        .expect(200);

      const makes = res.body.data.map((l: { make: string }) => l.make).sort();
      expect(makes).toEqual(['UnderFive', 'UnderSuv']);
      expect(res.body.pagination.total).toBe(2);

      const bikeRes = await request(app.getHttpServer())
        .get(`/categories/${bikes.id}/listings`)
        .expect(200);
      expect(bikeRes.body.data.map((l: { make: string }) => l.make)).toEqual(['UnderBikes']);
    });

    it('applies filters and pagination on the scoped endpoint', async () => {
      const { cars } = await seedScoped();

      const filtered = await request(app.getHttpServer())
        .get(`/categories/${cars.id}/listings?fuelType=diesel`)
        .expect(200);
      expect(filtered.body.pagination.total).toBe(0);

      const paged = await request(app.getHttpServer())
        .get(`/categories/${cars.id}/listings?limit=1`)
        .expect(200);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.pagination.hasMore).toBe(true);
      expect(typeof paged.body.pagination.nextCursor).toBe('string');
    });

    it('returns 404 for an unknown category instead of every listing', async () => {
      const res = await request(app.getHttpServer())
        .get('/categories/999999/listings')
        .expect(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('rejects a listing pointing at an unknown category', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .send({
          make: 'Ghost',
          model: 'X',
          year: 2021,
          mileage: 1,
          price: 1,
          condition: 'used',
          transmission: 'manual',
          fuelType: 'petrol',
          color: 'Red',
          location: 'Jakarta',
          categoryId: 999999,
        })
        .expect(422);

      expect(res.body.error.code).toBe('unprocessable_entity');
    });
  });
});
