import { EXCLUDED_TABLES, TABLE_PLANS } from './plan';
import type { RunReport } from './runner';

/**
 * The completion summary (REQ-IMPORT-01.4).
 *
 * Written to be read *before* the real run, because that is the whole purpose
 * of dry-run mode: the operator compares these counts against the source and
 * reads the skip reasons, and only then points the script at a real target. A
 * summary that is hard to skim defeats the mechanism, so the per-table table
 * leads with the arithmetic and anything unusual is called out underneath it
 * rather than left to be noticed.
 */
export function formatRunReport(report: RunReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(
    report.dryRun
      ? '=== DRY RUN — nothing was written ==='
      : `=== Import complete — tenant #${String(report.tenantId)} ===`,
  );
  lines.push('');

  const width = Math.max(...report.tables.map((t) => t.source.length), 'source table'.length);
  lines.push(
    `${'source table'.padEnd(width)}  ${'source'.padStart(7)}  ${'imported'.padStart(8)}  ` +
      `${'skipped'.padStart(7)}  nulled`,
  );
  lines.push(`${'-'.repeat(width)}  ${'-'.repeat(7)}  ${'-'.repeat(8)}  ${'-'.repeat(7)}  ------`);

  let sourceTotal = 0;
  let importedTotal = 0;
  let skippedTotal = 0;
  let nulledTotal = 0;
  const cell = (n: number, w: number): string => (n === 0 ? ''.padStart(w) : String(n).padStart(w));

  for (const table of report.tables) {
    const skipped = table.skipped.reduce((sum, s) => sum + s.count, 0);
    const nulled = table.nulled.reduce((sum, s) => sum + s.count, 0);
    sourceTotal += table.sourceRows;
    importedTotal += table.imported;
    skippedTotal += skipped;
    nulledTotal += nulled;
    lines.push(
      `${table.source.padEnd(width)}  ${String(table.sourceRows).padStart(7)}  ` +
        `${String(table.imported).padStart(8)}  ${cell(skipped, 7)}  ${cell(nulled, 6)}`,
    );
  }

  lines.push(`${'-'.repeat(width)}  ${'-'.repeat(7)}  ${'-'.repeat(8)}  ${'-'.repeat(7)}  ------`);
  lines.push(
    `${'total'.padEnd(width)}  ${String(sourceTotal).padStart(7)}  ` +
      `${String(importedTotal).padStart(8)}  ${cell(skippedTotal, 7)}  ${cell(nulledTotal, 6)}`,
  );
  // Said rather than left to be worked out: the two columns answer different
  // questions, and only the first one has to close against the source.
  lines.push('');
  lines.push(
    `imported + skipped = ${String(importedTotal + skippedTotal)}, against ` +
      `${String(sourceTotal)} source row(s). "nulled" counts columns blanked on rows that ` +
      'were imported, so it is not part of that sum.',
  );

  // Skipped rows, grouped by reason. REQ-IMPORT-01.4 asks for "any rows skipped
  // and why", and the reason is the part worth reading: an orphaned foreign key
  // in the source is expected and fine, while a required column arriving NULL
  // usually is not.
  const withSkips = report.tables.filter((t) => t.skipped.length > 0);
  if (withSkips.length > 0) {
    lines.push('');
    lines.push('Rows not imported, by reason:');
    for (const table of withSkips) {
      for (const skip of table.skipped) {
        lines.push(`  ${String(skip.count).padStart(5)}  ${skip.reason}`);
      }
    }
  }

  // Kept out of the list above. These rows were imported; one of their columns
  // was not, and reporting that as "not imported" overstates it.
  const withNulls = report.tables.filter((t) => t.nulled.length > 0);
  if (withNulls.length > 0) {
    lines.push('');
    lines.push('Columns blanked on rows that WERE imported, by reason:');
    for (const table of withNulls) {
      for (const entry of table.nulled) {
        lines.push(`  ${String(entry.count).padStart(5)}  ${entry.reason}`);
      }
    }
  }

  if (report.backfills.length > 0) {
    lines.push('');
    lines.push('Second-pass and derived writes:');
    for (const pass of report.backfills) {
      lines.push(`  ${String(pass.rows).padStart(5)}  ${pass.describe} (${pass.name})`);
    }
  }

  if (report.notes.length > 0) {
    lines.push('');
    lines.push('Notes:');
    // Identical notes collapse with a count. The feedback split emits one per
    // ticket, which would otherwise bury everything else in the report.
    const counted = new Map<string, number>();
    for (const note of report.notes) counted.set(note, (counted.get(note) ?? 0) + 1);
    for (const [note, count] of counted) {
      lines.push(count === 1 ? `  - ${note}` : `  - (x${count}) ${note}`);
    }
  }

  lines.push('');
  lines.push(`Tables excluded by design: ${EXCLUDED_TABLES.length}. Tables imported: ${TABLE_PLANS.length}.`);
  lines.push('Run with --explain to print the reason for every exclusion and dropped column.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Every deliberate omission, with its reason.
 *
 * Separate from the run report because it is long and unchanging — it belongs
 * in the record of a decision rather than in the output of every run. Printed
 * on `--explain`, and the thing to read when somebody asks why a column did not
 * come across.
 */
export function formatExclusions(): string {
  const lines: string[] = ['', '=== What this import deliberately leaves behind ===', ''];

  lines.push('Tables not imported:');
  for (const entry of EXCLUDED_TABLES) {
    lines.push(`  ${entry.source}${entry.expectedAbsent ? ' (expected not to exist)' : ''}`);
    lines.push(`      ${entry.reason}`);
  }

  lines.push('');
  lines.push('Columns not imported, or imported differently:');
  for (const plan of TABLE_PLANS) {
    const notable = Object.entries(plan.columns).filter(
      ([, rule]) => rule.kind === 'drop' || rule.kind === 'custom',
    );
    // `id` carries a `custom` rule on every table for the same uninteresting
    // reason, so it is not worth a line in a report meant to be read.
    const interesting = notable.filter(([column]) => column !== 'id');
    if (interesting.length === 0) continue;

    lines.push(`  ${plan.source}`);
    for (const [column, rule] of interesting) {
      const reason = rule.kind === 'drop' || rule.kind === 'custom' ? rule.reason : '';
      lines.push(`      ${column}: ${reason}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
