/**
 * One-shot restaurant import from .xlsx or .csv
 *
 * Usage:
 *   npm run import:restaurants -- path/to/restaurants.xlsx
 *   npm run import:restaurants -- path/to/restaurants.csv
 *
 * Required columns (case-insensitive):
 *   name, address, city
 *
 * Optional columns:
 *   phone, website (or "website url"), description (or "notes")
 *
 * City values must match an active city name in the database (e.g. "Cincinnati", "Dayton").
 * Rows with a name that already exists (case-insensitive) are skipped.
 * Geocoding runs if GEOCODING_API_KEY is configured; otherwise lat/lng are left null.
 */

import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { DataSource } from 'typeorm';
import { RestaurantEntity, ImportSource } from '../database/entities/restaurant.entity';
import { CityEntity } from '../database/entities/city.entity';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

// ─── DB connection ────────────────────────────────────────────────────────────

const dataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [RestaurantEntity, CityEntity],
  synchronize: false,
  logging: false,
});

// ─── Geocoding ────────────────────────────────────────────────────────────────

interface Coords {
  lat: number;
  lng: number;
}

async function geocode(address: string): Promise<Coords | null> {
  const key = process.env.GEOCODING_API_KEY;
  if (!key || key.startsWith('your_')) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      status: string;
      results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };
    if (data.status !== 'OK' || !data.results.length) return null;
    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng };
  } catch {
    return null;
  }
}

// ─── Row parsing ──────────────────────────────────────────────────────────────

interface ImportRow {
  name: string;
  address: string;
  city: string;
  phone: string | undefined;
  website: string | undefined;
  description: string | undefined;
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseFile(filePath: string): ImportRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  return raw
    .map((r) => {
      const n: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        n[normalizeKey(k)] = String(v).trim();
      }

      const name =
        n['name'] ?? n['restaurant name'] ?? n['location name'] ?? n['restaurant'] ?? '';
      const address = n['address'] ?? n['full address'] ?? n['street address'] ?? '';
      const city = n['city'] ?? '';
      const phone = n['phone'] || n['phone number'] || undefined;
      const website = n['website'] || n['website url'] || n['url'] || undefined;
      const description = n['description'] || n['notes'] || n['note'] || undefined;

      return { name, address, city, phone, website, description };
    })
    .filter((r) => r.name && r.address && r.city);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('\nUsage: npm run import:restaurants -- <path-to-file.xlsx>\n');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`\nFile not found: ${absPath}\n`);
    process.exit(1);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  DinnerBears — Restaurant Import');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  File: ${absPath}`);

  let rows: ImportRow[];
  try {
    rows = parseFile(absPath);
  } catch (err) {
    console.error(`\nFailed to parse file: ${(err as Error).message}\n`);
    process.exit(1);
  }

  console.log(`  Rows:  ${rows.length} valid\n`);

  if (rows.length === 0) {
    console.log('  No valid rows found. Check that the file has name, address, and city columns.\n');
    process.exit(0);
  }

  await dataSource.initialize();

  const restaurantRepo = dataSource.getRepository(RestaurantEntity);
  const cityRepo = dataSource.getRepository(CityEntity);

  const cities = await cityRepo.find({ where: { isActive: true } });
  const cityMap = new Map(cities.map((c) => [c.name.toLowerCase(), c.id]));
  console.log(`  Cities: ${[...cityMap.keys()].join(', ')}\n`);

  // Load all existing names for fast duplicate lookup
  const existing = await restaurantRepo.find({ select: ['name'] });
  const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const cityId = cityMap.get(row.city.toLowerCase());
    if (!cityId) {
      console.log(`  [SKIP]   "${row.name}" — unknown city "${row.city}"`);
      skipped++;
      continue;
    }

    if (existingNames.has(row.name.toLowerCase())) {
      console.log(`  [SKIP]   "${row.name}" — already exists`);
      skipped++;
      continue;
    }

    // Geocode with a small delay between calls to stay under rate limits
    process.stdout.write(`  [IMPORT] "${row.name}" — geocoding...`);
    const coords = await geocode(row.address);
    if (coords) {
      process.stdout.write(` (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})\n`);
      await new Promise((r) => setTimeout(r, 150));
    } else {
      process.stdout.write(` (no coords)\n`);
    }

    try {
      const restaurant = restaurantRepo.create({
        name: row.name,
        address: row.address,
        cityId,
        phone: row.phone ?? null,
        websiteUrl: row.website ?? null,
        description: row.description ?? null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        importedFrom: ImportSource.FACEBOOK_IMPORT,
        isActive: true,
      });
      await restaurantRepo.save(restaurant);
      existingNames.add(row.name.toLowerCase());
      inserted++;
    } catch (err) {
      console.error(`  [ERROR]  "${row.name}" — ${(err as Error).message}`);
      errors++;
    }
  }

  await dataSource.destroy();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Total:    ${rows.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
