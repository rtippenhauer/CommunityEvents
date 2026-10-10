-- Which release a report shipped in (Rob, 2026-10-04).
--
-- The workflow this serves: a phase pulls in the reports it will cover, each
-- becomes `resolved` when the code lands, and on release each becomes `shipped`
-- carrying the version. Automation does the flipping, which is why the PATCH
-- route now admits the `automation` role alongside `system_admin`.
--
-- **A plain foreign key, not a join table**: a report ships once, so this is one
-- release to many reports. `releases` is global like `system_reports`, so the
-- key crosses no tenant boundary and needs no scoping.
--
-- ## Why the credit cannot live in the note's text
--
-- Release notes are authored in the repo and imported by
-- `release-notes-importer.service` into every deployment, keyed by version --
-- one blob of markdown, identical everywhere. A name written into that text
-- would therefore be fixed copy naming one community's member to every other
-- community on the platform, which is precisely the disclosure `system_reports`
-- is careful about everywhere else.
--
-- So the credit is this LINK, not prose. Each community resolves it through its
-- own scoped client and renders what it is entitled to: the contributor's name
-- at home, "a community member" everywhere else. The thanks line is therefore
-- different text in every community while the release note stays one artifact.
--
-- SET NULL rather than CASCADE: deleting a release should lose the attribution,
-- never the report.

ALTER TABLE `system_reports`
  ADD COLUMN `shipped_in_release_id` INT UNSIGNED NULL AFTER `resolved_at`,
  ADD INDEX `fk_system_report_release` (`shipped_in_release_id`),
  ADD CONSTRAINT `fk_system_report_release` FOREIGN KEY (`shipped_in_release_id`)
    REFERENCES `releases`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
