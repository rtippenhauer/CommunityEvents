import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 35 (Residence "what are you bringing"): optional free-text note a
// member can attach to a Going RSVP, shown next to their name in the
// attendee list for events at Residence locations. Not location-gated
// server-side (same trust model as guest_names) — the UI only offers the
// input for Residence events.
export class AddBringingItemToEventRsvps1785000000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'event_rsvps' AND column_name = 'bringing_item'`,
    );
    if (Number(existing[0]?.n ?? 0) > 0) return; // already added

    await queryRunner.query(`
      ALTER TABLE event_rsvps
        ADD COLUMN bringing_item VARCHAR(200) NULL AFTER guest_names
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE event_rsvps DROP COLUMN bringing_item`);
  }
}
