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
  'Honda Motor': ['CBR150R', 'Vario', 'Beat', 'PCX'],
  Yamaha: ['R15', 'NMAX', 'Mio', 'Aerox'],
  Kawasaki: ['Ninja 250', 'W175'],
  'Suzuki Motor': ['Satria F150', 'Address'],
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

/** Motorcycles price and wear far below cars, so the ranges differ. */
const MOTORCYCLE_MAKES = new Set(['Honda Motor', 'Yamaha', 'Kawasaki', 'Suzuki Motor']);

/** Two roots with children, enough to exercise category-scoped browsing. */
const CATEGORY_TREE: Array<{ name: string; slug: string; children: Array<{ name: string; slug: string }> }> = [
  {
    name: 'Cars',
    slug: 'cars',
    children: [
      { name: 'SUV', slug: 'suv' },
      { name: 'Sedan', slug: 'sedan' },
      { name: 'Hatchback', slug: 'hatchback' },
    ],
  },
  {
    name: 'Motorcycles',
    slug: 'motorcycles',
    children: [
      { name: 'Sport', slug: 'sport' },
      { name: 'Scooter', slug: 'scooter' },
    ],
  },
];

/** Model to leaf slug, so a listing's category matches what it actually is. */
const CATEGORY_BY_MODEL: Record<string, string> = {
  'Pajero Sport': 'suv', 'CR-V': 'suv', 'X-Trail': 'suv', 'CX-5': 'suv', 'CX-3': 'suv',
  'Outlander': 'suv', 'Terios': 'suv', 'Rush': 'suv', 'Fortuner': 'suv', 'XL7': 'suv',
  'Almaz': 'suv', 'Creta': 'suv', 'Santa Fe': 'suv', 'MU-X': 'suv', 'X3': 'suv',
  'GLA': 'suv', 'GLC': 'suv', 'Kicks': 'suv', 'HR-V': 'suv',
  'Civic': 'sedan', 'Mazda3': 'sedan', '320i': 'sedan', '520i': 'sedan', 'C200': 'sedan',
  'E250': 'sedan', 'S450': 'sedan', 'Camry': 'sedan',
  'Ayla': 'hatchback', 'Brio': 'hatchback', 'Ignis': 'hatchback', 'Baleno': 'hatchback',
  'Yaris': 'hatchback', 'Mazda': 'hatchback', 'MX-5': 'hatchback', 'Ioniq 5': 'hatchback',
  'Air EV': 'hatchback', 'M4': 'sedan',
  'Avanza': 'suv', 'Xenia': 'suv', 'Mobilio': 'suv', 'Ertiga': 'suv', 'Sigra': 'suv',
  'Calya': 'suv', 'Innova': 'suv', 'Stargazer': 'suv', 'Confero': 'suv', 'Cortez': 'suv',
  'Livina': 'suv', 'Serena': 'suv', 'X1': 'suv', 'Gran Max': 'suv', 'L300': 'suv',
  'Carry': 'suv', 'Panther': 'suv', 'D-Max': 'suv',
  'CBR150R': 'sport', 'R15': 'sport', 'Ninja 250': 'sport', 'Satria F150': 'sport',
  'Vario': 'scooter', 'Beat': 'scooter', 'PCX': 'scooter', 'NMAX': 'scooter',
  'Mio': 'scooter', 'Aerox': 'scooter', 'W175': 'sport', 'Address': 'scooter',
};

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

function isMotorcycle(make: string): boolean {
  return MOTORCYCLE_MAKES.has(make);
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
  'category_id',
  'created_at',
  'updated_at',
] as const;

type SeedRow = Record<(typeof COLUMNS)[number], string | number | string[] | null>;

/** Set once the category tree exists; maps a model to its leaf category id. */
let categoryIdFor: (model: string) => number | null = () => null;

function buildRow(index: number): SeedRow {
  const make = pick(MAKES);
  const model = pick(MODELS_BY_MAKE[make]);
  const createdAt = new Date(Date.UTC(2026, 0, 1) - int(0, SPREAD_DAYS) * 86_400_000);

  return {
    make,
    model,
    year: int(2010, 2024),
    mileage: isMotorcycle(make) ? int(0, 60_000) : int(0, 200_000),
    // Whole millions of IDR. Motorcycles sit far below cars in price and
    // odometer, so a single range would misrepresent one of them.
    price: (isMotorcycle(make) ? int(8, 120) : int(20, 1_500)) * 1_000_000,
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
    category_id: categoryIdFor(model),
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
    // listings references categories, so clear the link before the tree.
    await client.query('UPDATE listings SET category_id = NULL');
    await client.query('TRUNCATE TABLE listings RESTART IDENTITY');
    await client.query('DELETE FROM categories');

    // Category ids are assigned by the database, so capture the leaf ids by slug
    // instead of assuming values.
    const leafIdBySlug = new Map<string, number>();
    for (const root of CATEGORY_TREE) {
      const { rows: rootRows } = await client.query<{ id: number }>(
        `INSERT INTO categories (parent_id, name, slug, path, depth)
         VALUES (NULL, $1, $2, $3::ltree, 1) RETURNING id`,
        [root.name, root.slug, root.slug],
      );
      for (const child of root.children) {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO categories (parent_id, name, slug, path, depth)
           VALUES ($1, $2, $3, $4::ltree, 2) RETURNING id`,
          [rootRows[0].id, child.name, child.slug, `${root.slug}.${child.slug}`],
        );
        leafIdBySlug.set(child.slug, rows[0].id);
      }
    }
    categoryIdFor = (model: string) => leafIdBySlug.get(CATEGORY_BY_MODEL[model] ?? '') ?? null;

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
