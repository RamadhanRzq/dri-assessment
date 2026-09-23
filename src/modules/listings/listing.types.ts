export const LISTING_CONDITIONS = ['new', 'used', 'certified'] as const;
export const LISTING_TRANSMISSIONS = ['manual', 'automatic', 'cvt'] as const;
export const LISTING_FUEL_TYPES = ['petrol', 'diesel', 'electric', 'hybrid'] as const;
export const LISTING_STATUSES = ['available', 'pending', 'sold', 'removed'] as const;

export type ListingCondition = (typeof LISTING_CONDITIONS)[number];
export type ListingTransmission = (typeof LISTING_TRANSMISSIONS)[number];
export type ListingFuelType = (typeof LISTING_FUEL_TYPES)[number];
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Row shape as stored, with bigint columns already parsed to numbers. */
export type ListingRow = {
  id: number;
  make: string;
  model: string;
  year: number;
  mileage: number;
  price: number;
  condition: ListingCondition;
  transmission: ListingTransmission;
  fuel_type: ListingFuelType;
  color: string;
  images: string[];
  location: string;
  status: ListingStatus;
  category_id: number | null;
  created_at: Date;
  updated_at: Date;
};

export const LISTING_COLUMNS = `id, make, model, year, mileage, price, condition,
  transmission, fuel_type, color, images, location, status, category_id, created_at, updated_at`;

/**
 * Browse rows carry an extra exact-precision timestamp.
 *
 * `Date` only holds milliseconds, so a cursor built from it would drop the
 * microseconds Postgres stores and re-serve the boundary row on the next page.
 * The `::text` form round-trips through `timestamptz` exactly.
 */
export type BrowseRow = ListingRow & { created_at_cursor: string };
