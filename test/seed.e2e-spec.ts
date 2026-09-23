import { spawnSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/shared/database/database.service.js';

/**
 * The seeder is the fixture every browse/search test depends on, so its two
 * real contracts are worth defending: it must be repeatable (same rows every
 * run) and it must never produce a row the table rejects.
 *
 * Runs against automotive_marketplace_test; the Vitest config injects
 * DATABASE_URL so the spawned script inherits it.
 */
describe('Seed (e2e)', () => {
  let app: INestApplication;
  let db: DatabaseService;

  const COUNT = 60;

  const seed = (count: number = COUNT) => {
    const result = spawnSync(
      process.execPath,
      ['src/shared/database/seed.ts', String(count)],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };

  /** Order-independent hash of every column, so row order cannot mask a diff. */
  const fingerprint = async (): Promise<string> => {
    const [row] = await db.query<{ digest: string }>(
      `SELECT md5(string_agg(t, '|' ORDER BY t)) AS digest
         FROM (
           SELECT md5(concat_ws(',', make, model, year, mileage, price, condition,
                          transmission, fuel_type, color, location, status,
                          created_at, updated_at, array_to_string(images, ','))) AS t
             FROM listings
         ) s`,
    );
    return row.digest;
  };

  const countRows = async (): Promise<number> => {
    const [row] = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM listings',
    );
    return row.count;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('produces identical rows on every run', async () => {
    seed();
    const first = await fingerprint();

    seed();
    const second = await fingerprint();

    expect(second).toBe(first);
    expect(await countRows()).toBe(COUNT);
  });

  it('resets rather than appends', async () => {
    seed(COUNT);
    seed(10);

    expect(await countRows()).toBe(10);
  });

  it('inserts only rows the table accepts', async () => {
    seed();

    const [row] = await db.query<{ invalid: number }>(
      `SELECT count(*)::int AS invalid
         FROM listings
        WHERE year NOT BETWEEN 1900 AND 2100
           OR mileage < 0
           OR price < 0
           OR condition NOT IN ('new', 'used', 'certified')
           OR transmission NOT IN ('manual', 'automatic', 'cvt')
           OR fuel_type NOT IN ('petrol', 'diesel', 'electric', 'hybrid')
           OR status NOT IN ('available', 'pending', 'sold', 'removed')`,
    );
    expect(row.invalid).toBe(0);
  });

  it('spreads values across every filterable dimension', async () => {
    seed(200);

    const [row] = await db.query<{
      makes: number;
      cities: number;
      years: number;
      fuels: number;
      transmissions: number;
      statuses: number;
    }>(
      `SELECT count(DISTINCT make)::int          AS makes,
              count(DISTINCT location)::int      AS cities,
              count(DISTINCT year)::int          AS years,
              count(DISTINCT fuel_type)::int     AS fuels,
              count(DISTINCT transmission)::int  AS transmissions,
              count(DISTINCT status)::int        AS statuses
         FROM listings`,
    );

    // A seed that only exercises one bucket would hide filter bugs.
    expect(row.makes).toBeGreaterThan(1);
    expect(row.cities).toBeGreaterThan(1);
    expect(row.years).toBeGreaterThan(1);
    expect(row.fuels).toBeGreaterThan(1);
    expect(row.transmissions).toBeGreaterThan(1);
    expect(row.statuses).toBeGreaterThan(1);
  });
});
