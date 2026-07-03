import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomIconLibrary1751100000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN icon VARCHAR(255) NOT NULL DEFAULT 'emoji_events'
    `);

    await runner.query(`
      CREATE TABLE custom_icons (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        image_path VARCHAR(500) NOT NULL,
        created_by INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_custom_icons_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE custom_icons`);
    await runner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN icon VARCHAR(80) NOT NULL DEFAULT 'emoji_events'
    `);
  }
}
