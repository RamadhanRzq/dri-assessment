// Deterministic seeder for the listings table.
//
//   npm run seed          # 500 rows
//   npm run seed 50       # 50 rows
//
// Every value is drawn from a fixed pool with a fixed-seed PRNG, so the same
// command always produces the same rows. The run truncates first, so it resets
// as well as seeds, and it refuses to touch production.

import pg from 'pg';

const DEFAULT_COUNT = 500;
const SEED = 20260923;
const BATCH_SIZE = 100;

/** Days of history that created_at is spread over. */
const SPREAD_DAYS = 180;

/** Models are listed per make so the pairs stay realistic. */
const MODELS_BY_MAKE: Record<string, string[]> = {
  Toyota: ['Avanza', 'Innova', 'Rush', 'Yaris', 'Calya', 'Fortuner'],
  Daihatsu: ['Xenia', 'Ayla', 'Terios', 'Sigra', 'Gran Max'],
  Honda: ['Brio', 'Mobilio', 'HR-V', 'CR-V', 'Civic'],
  Suzuki: ['Ertiga', 'Ignis', 'Baleno', 'XL7', 'Carry'],
  Mitsubishi: ['Xpander', 'Pajero Sport', 'L300', 'Outlander'],
  Nissan: ['Livina', 'Kicks', 'X-Trail', 'Serena'],
  Hyundai: ['Creta', 'Stargazer', 'Ioniq 5', 'Santa Fe'],
  Wuling: ['Almaz', 'Confero', 'Cortez', 'Air EV'],
  Mazda: ['CX-5', 'CX-3', 'Mazda3', 'MX-5'],
  Isuzu: ['Panther', 'D-Max', 'MU-X'],
  BMW: ['320i', '520i', 'X1', 'X3', 'M4'],
  'Mercedes-Benz': ['C200', 'E250', 'GLA', 'GLC', 'S450'],
};

const CITIES = [
  'Jakarta',
  'Bandung',
  'Surabaya',
  'Medan',
  'Semarang',
  'Makassar',
  'Denpasar',
  'Yogyakarta',
  'Bekasi',
  'Tangerang',
];

const COLORS = ['Hitam', 'Putih', 'Silver', 'Abu-abu', 'Merah', 'Biru', 'Cokelat'];

// Mirrors the CHECK constraints in the migration.
const CONDITIONS = ['new', 'used', 'certified'];
const TRANSMISSIONS = ['manual', 'automatic', 'cvt'];
const FUEL_TYPES = ['petrol', 'diesel', 'electric', 'hybrid'];
const STATUSES = ['available', 'pending', 'sold', 'removed'];

const MAKES = Object.keys(MODELS_BY_MAKE);

/** mulberry32: small, fast, and identical across runs and platforms. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Inclusive on both ends. */
function int(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

const COLUMNS = [
  'make',
  'model',
  'year',
  'mileage',
  'price',
  'condition',
  'transmission',
  'fuel_type',
  'color',
  'images',
  'location',
  'status',
  'created_at',
  'updated_at',
] as const;

type SeedRow = Record<(typeof COLUMNS)[number], string | number | string[]>;

function buildRow(index: number): SeedRow {
  const make = pick(MAKES);
  const createdAt = new Date(Date.UTC(2026, 0, 1) - int(0, SPREAD_DAYS) * 86_400_000);

  return {
    make,
    model: pick(MODELS_BY_MAKE[make]),
    year: int(2010, 2024),
    mileage: int(0, 200_000),
    // Whole millions of IDR, from 20m to 1.5b.
    price: int(20, 1_500) * 1_000_000,
    condition: pick(CONDITIONS),
    transmission: pick(TRANSMISSIONS),
    fuel_type: pick(FUEL_TYPES),
    color: pick(COLORS),
    images: Array.from(
      { length: int(1, 4) },
      (_, n) => `https://cdn.example.com/listings/${index}-${n}.jpg`,
    ),
    location: pick(CITIES),
    status: pick(STATUSES),
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString(),
  };
}

async function insertBatch(client: pg.PoolClient, rows: SeedRow[]): Promise<void> {
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = COLUMNS.map((column) => {
      values.push(row[column]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  await client.query(
    `INSERT INTO listings (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`,
    values,
  );
}

const count = Number(process.argv[2] ?? DEFAULT_COUNT);

if (!Number.isSafeInteger(count) || count < 1) {
  console.error('Count must be a positive integer.');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to reset and seed a production database.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE listings RESTART IDENTITY');

    for (let offset = 0; offset < count; offset += BATCH_SIZE) {
      const size = Math.min(BATCH_SIZE, count - offset);
      const rows = Array.from({ length: size }, (_, i) => buildRow(offset + i + 1));
      await insertBatch(client, rows);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const summary = await pool.query<{ status: string; count: number }>(
    'SELECT status, count(*)::int AS count FROM listings GROUP BY status ORDER BY count DESC',
  );

  console.log(`seeded ${count} listings`);
  for (const row of summary.rows) console.log(`  ${row.status}: ${row.count}`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
