import { MigrationInterface, QueryRunner } from 'typeorm';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { basename, join } from 'path';

const UPLOAD_PATH = process.env.UPLOAD_PATH ?? '/app/uploads';

// Restaurant photos and profile photos used to share one flat uploads directory,
// both served publicly with no auth check. This splits them into subdirectories
// so profile photos can be gated behind a login-required route (see
// ProfilePhotosController) while restaurant photos stay public — intentionally,
// since they're reused in guest-facing emails and social posts.
export class SeparateUploadDirectories1751300000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const restaurantsDir = join(UPLOAD_PATH, 'restaurants');
    const profilesDir = join(UPLOAD_PATH, 'profiles');
    mkdirSync(restaurantsDir, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });

    const photos: Array<{ id: number; file_path: string }> = await runner.query(
      `SELECT id, file_path FROM restaurant_photos WHERE file_path LIKE '/api/uploads/%' AND file_path NOT LIKE '/api/uploads/restaurants/%'`,
    );
    for (const p of photos) {
      const filename = basename(p.file_path);
      const oldFile = join(UPLOAD_PATH, filename);
      if (existsSync(oldFile)) renameSync(oldFile, join(restaurantsDir, filename));
      await runner.query(`UPDATE restaurant_photos SET file_path = ? WHERE id = ?`, [
        `/api/uploads/restaurants/${filename}`,
        p.id,
      ]);
    }

    const users: Array<{ id: number; profile_photo_path: string }> = await runner.query(
      `SELECT id, profile_photo_path FROM users WHERE profile_photo_path LIKE '/api/uploads/%'`,
    );
    for (const u of users) {
      const filename = basename(u.profile_photo_path);
      const oldFile = join(UPLOAD_PATH, filename);
      if (existsSync(oldFile)) renameSync(oldFile, join(profilesDir, filename));
      await runner.query(`UPDATE users SET profile_photo_path = ? WHERE id = ?`, [
        `/api/v1/uploads/profiles/${filename}`,
        u.id,
      ]);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const restaurantsDir = join(UPLOAD_PATH, 'restaurants');
    const profilesDir = join(UPLOAD_PATH, 'profiles');

    const photos: Array<{ id: number; file_path: string }> = await runner.query(
      `SELECT id, file_path FROM restaurant_photos WHERE file_path LIKE '/api/uploads/restaurants/%'`,
    );
    for (const p of photos) {
      const filename = basename(p.file_path);
      const newFile = join(restaurantsDir, filename);
      if (existsSync(newFile)) renameSync(newFile, join(UPLOAD_PATH, filename));
      await runner.query(`UPDATE restaurant_photos SET file_path = ? WHERE id = ?`, [
        `/api/uploads/${filename}`,
        p.id,
      ]);
    }

    const users: Array<{ id: number; profile_photo_path: string }> = await runner.query(
      `SELECT id, profile_photo_path FROM users WHERE profile_photo_path LIKE '/api/v1/uploads/profiles/%'`,
    );
    for (const u of users) {
      const filename = basename(u.profile_photo_path);
      const newFile = join(profilesDir, filename);
      if (existsSync(newFile)) renameSync(newFile, join(UPLOAD_PATH, filename));
      await runner.query(`UPDATE users SET profile_photo_path = ? WHERE id = ?`, [
        `/api/uploads/${filename}`,
        u.id,
      ]);
    }
  }
}
