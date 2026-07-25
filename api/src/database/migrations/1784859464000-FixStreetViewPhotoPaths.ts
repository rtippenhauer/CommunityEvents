import { MigrationInterface, QueryRunner } from 'typeorm';

// EnrichmentService.downloadStreetViewPhoto has always saved its file to
// <uploadPath>/locations/<filename> (correct) but recorded file_path as
// `/api/uploads/<filename>` — missing the `locations/` segment main.ts's
// static file route requires — so every Street View fallback photo (used
// when a location has no Google Places photos, e.g. a newly added location
// or a private home) has rendered as a broken image. The file itself was
// never in the wrong place; only the stored URL was wrong. This repairs
// existing rows; the code fix (enrichment.service.ts) stops new ones.
export class FixStreetViewPhotoPaths1784859464000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE location_photos
      SET file_path = REPLACE(file_path, '/api/uploads/', '/api/uploads/locations/')
      WHERE file_path REGEXP '^/api/uploads/[0-9]+-[0-9]+\\\\.(jpg|jpeg|png|webp)$'
    `);
  }

  // Intentional no-op: after up() runs, a row it fixed is indistinguishable
  // from a row that was already correct (both match
  // /api/uploads/locations/<file>) — a "smart" down() using that same
  // pattern would strip the locations/ segment from every correct row too,
  // corrupting photos this migration never touched. Reverting a data
  // repair back to a known-broken state isn't a real recovery path anyway.
  public async down(): Promise<void> {}
}
