import { MigrationInterface, QueryRunner } from 'typeorm';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { basename, join } from 'path';

const UPLOAD_PATH = process.env.UPLOAD_PATH ?? '/app/uploads';

// Companion to RenameRestaurantsToLocations: moves the physical photo files
// from uploads/restaurants/ to uploads/locations/ and rewrites file_path on
// the now-renamed location_photos table, same approach as
// SeparateUploadDirectories used when restaurant photos first got their own
// subdirectory.
export class MoveLocationUploads1784808400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const oldDir = join(UPLOAD_PATH, 'restaurants');
    const newDir = join(UPLOAD_PATH, 'locations');
    mkdirSync(newDir, { recursive: true });

    const photos: Array<{ id: number; file_path: string }> = await runner.query(
      `SELECT id, file_path FROM location_photos WHERE file_path LIKE '/api/uploads/restaurants/%'`,
    );
    for (const p of photos) {
      const filename = basename(p.file_path);
      const oldFile = join(oldDir, filename);
      if (existsSync(oldFile)) renameSync(oldFile, join(newDir, filename));
      await runner.query(`UPDATE location_photos SET file_path = ? WHERE id = ?`, [
        `/api/uploads/locations/${filename}`,
        p.id,
      ]);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const oldDir = join(UPLOAD_PATH, 'restaurants');
    const newDir = join(UPLOAD_PATH, 'locations');
    mkdirSync(oldDir, { recursive: true });

    const photos: Array<{ id: number; file_path: string }> = await runner.query(
      `SELECT id, file_path FROM location_photos WHERE file_path LIKE '/api/uploads/locations/%'`,
    );
    for (const p of photos) {
      const filename = basename(p.file_path);
      const newFile = join(newDir, filename);
      if (existsSync(newFile)) renameSync(newFile, join(oldDir, filename));
      await runner.query(`UPDATE location_photos SET file_path = ? WHERE id = ?`, [
        `/api/uploads/restaurants/${filename}`,
        p.id,
      ]);
    }
  }
}
