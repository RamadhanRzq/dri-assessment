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

/**
 * Filter attributes the seeder defines, with the categories that expose them.
 *
 * Mirrors what a real deployment would configure: capacity and fuel apply to
 * both roots, seats only to cars, and a boolean that is genuinely boolean.
 */
const ATTRIBUTE_DEFINITIONS: Array<{
  key: string;
  label: string;
  type: 'enum' | 'range' | 'boolean';
  unit?: string;
  options?: string[];
  categories: string[];
}> = [
  {
    key: 'engine_capacity',
    label: 'Engine Capacity',
    type: 'range',
    unit: 'cc',
    categories: ['cars', 'motorcycles'],
  },
  {
    key: 'fuel_type',
    label: 'Fuel Type',
    type: 'enum',
    options: FUEL_TYPES,
    categories: ['cars', 'motorcycles'],
  },
  { key: 'seat_count', label: 'Seat Count', type: 'range', unit: 'seats', categories: ['cars'] },
  { key: 'is_negotiable', label: 'Negotiable', type: 'boolean', categories: ['cars', 'motorcycles'] },
];

/** Engine capacity range per root slug, in cc. */
const ENGINE_CC: Record<string, [number, number]> = {
  cars: [1000, 3500],
  motorcycles: [110, 1300],
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

/** A row plus the attribute values that belong to it. */
type SeedListing = { row: SeedRow; attributes: Record<string, string | number | boolean> };

function buildRow(index: number): SeedListing {
  const make = pick(MAKES);
  const model = pick(MODELS_BY_MAKE[make]);
  const createdAt = new Date(Date.UTC(2026, 0, 1) - int(0, SPREAD_DAYS) * 86_400_000);
  const root = isMotorcycle(make) ? 'motorcycles' : 'cars';
  const fuelType = pick(FUEL_TYPES);
  const [ccMin, ccMax] = ENGINE_CC[root];

  const row: SeedRow = {
    make,
    model,
    year: int(2010, 2024),
    mileage: isMotorcycle(make) ? int(0, 60_000) : int(0, 200_000),
    // Whole millions of IDR. Motorcycles sit far below cars in price and
    // odometer, so a single range would misrepresent one of them.
    price: (isMotorcycle(make) ? int(8, 120) : int(20, 1_500)) * 1_000_000,
    condition: pick(CONDITIONS),
    transmission: pick(TRANSMISSIONS),
    fuel_type: fuelType,
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

  const attributes: Record<string, string | number | boolean> = {
    engine_capacity: int(ccMin, ccMax),
    fuel_type: fuelType,
    is_negotiable: pick(['true', 'false']) === 'true',
  };
  // Seats are a car attribute; leaving them off motorcycles also exercises the
  // "attribute present for some listings only" path the facet counts must handle.
  if (root === 'cars') attributes.seat_count = pick([2, 5, 7]);

  return { row, attributes };
}

/**
 * Column each seeded attribute writes. Fixed per key, so the value column is
 * never chosen from input.
 */
const VALUE_COLUMN_BY_KEY: Record<string, 'value_text' | 'value_num' | 'value_bool'> = {
  engine_capacity: 'value_num',
  seat_count: 'value_num',
  fuel_type: 'value_text',
  is_negotiable: 'value_bool',
};

/** Filled once the definitions exist, so rows can reference them by key. */
const attributeIdByKey = new Map<string, number>();

async function insertBatch(client: pg.PoolClient, listings: SeedListing[]): Promise<void> {
  const values: unknown[] = [];
  const tuples = listings.map(({ row }) => {
    const placeholders = COLUMNS.map((column) => {
      values.push(row[column]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const { rows: inserted } = await client.query<{ id: number }>(
    `INSERT INTO listings (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')} RETURNING id`,
    values,
  );

  // One statement per value column, so every tuple in it has the same shape.
  const byColumn = new Map<string, unknown[]>();
  listings.forEach(({ attributes }, index) => {
    for (const [key, value] of Object.entries(attributes)) {
      const attributeId = attributeIdByKey.get(key);
      const column = VALUE_COLUMN_BY_KEY[key];
      if (attributeId === undefined || column === undefined) continue;

      const params = byColumn.get(column) ?? [];
      params.push(inserted[index].id, attributeId, value);
      byColumn.set(column, params);
    }
  });

  for (const [column, params] of byColumn) {
    const tupleSql = params
      .map((_, i) => i)
      .filter((i) => i % 3 === 0)
      .map((i) => `($${i + 1}, $${i + 2}, $${i + 3})`)
      .join(', ');

    await client.query(
      `INSERT INTO listing_attribute_values (listing_id, attribute_id, ${column})
       VALUES ${tupleSql}`,
      params,
    );
  }
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
    // listing_attribute_values references both, hence the cascade.
    await client.query('UPDATE listings SET category_id = NULL');
    await client.query('TRUNCATE TABLE listings RESTART IDENTITY CASCADE');
    await client.query('DELETE FROM attributes');
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

    // Attribute definitions are global; `category_attributes` decides which
    // categories expose them.
    await client.query('DELETE FROM attributes');
    const categoryIdBySlug = new Map<string, number>(leafIdBySlug);
    for (const root of CATEGORY_TREE) {
      const { rows } = await client.query<{ id: number }>(
        'SELECT id FROM categories WHERE slug = $1',
        [root.slug],
      );
      categoryIdBySlug.set(root.slug, rows[0].id);
    }

    for (const definition of ATTRIBUTE_DEFINITIONS) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO attributes (key, label, type, unit, options)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          definition.key,
          definition.label,
          definition.type,
          definition.unit ?? null,
          definition.options ?? [],
        ],
      );
      attributeIdByKey.set(definition.key, rows[0].id);

      for (const slug of definition.categories) {
        await client.query(
          'INSERT INTO category_attributes (category_id, attribute_id) VALUES ($1, $2)',
          [categoryIdBySlug.get(slug), rows[0].id],
        );
      }
    }

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
