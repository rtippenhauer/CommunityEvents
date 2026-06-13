import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase751749000029000 implements MigrationInterface {
  name = 'Phase751749000029000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add non_validated to users.status enum
    await queryRunner.query(`
      ALTER TABLE users
      MODIFY COLUMN status ENUM('active','suspended','deleted','non_validated')
      NOT NULL DEFAULT 'active'
    `);

    // 2. Add non_validated_link to users.invite_source enum
    await queryRunner.query(`
      ALTER TABLE users
      MODIFY COLUMN invite_source ENUM('direct','facebook_group','google_oauth','non_validated_link')
      NULL
    `);

    // 3. Add status column to event_rsvps (going/maybe/not_going, default going)
    await queryRunner.query(`
      ALTER TABLE event_rsvps
      ADD COLUMN status ENUM('going','maybe','not_going') NOT NULL DEFAULT 'going'
    `);

    // 4. Add invite_flavor column to invites
    await queryRunner.query(`
      ALTER TABLE invites
      ADD COLUMN invite_flavor ENUM('member','non_validated') NULL
    `);

    // 5. Add event_invite to invites.type enum
    await queryRunner.query(`
      ALTER TABLE invites
      MODIFY COLUMN type ENUM('member','admin','campaign_facebook','guest_rsvp','shareable_rsvp','event_invite')
      NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE invites
      MODIFY COLUMN type ENUM('member','admin','campaign_facebook','guest_rsvp','shareable_rsvp')
      NOT NULL
    `);

    await queryRunner.query(`ALTER TABLE invites DROP COLUMN invite_flavor`);
    await queryRunner.query(`ALTER TABLE event_rsvps DROP COLUMN status`);

    await queryRunner.query(`
      ALTER TABLE users
      MODIFY COLUMN invite_source ENUM('direct','facebook_group','google_oauth')
      NULL
    `);

    await queryRunner.query(`
      ALTER TABLE users
      MODIFY COLUMN status ENUM('active','suspended','deleted')
      NOT NULL DEFAULT 'active'
    `);
  }
}
