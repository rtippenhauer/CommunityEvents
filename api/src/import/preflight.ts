import { EXCLUDED_TABLES, TABLE_PLANS } from './plan';
import { expectedSourceColumns } from './plan-types';

/**
 * Compares the live source database against the plan, before anything is read
 * or written (REQ-IMPORT-01.4's "fails fast, before writing anything").
 *
 * **This is the check that makes the import trustworthy rather than merely
 * careful.** The plan was written against v1 as it stands today, and v1 is a
 * deployed application still taking bugfixes — "v1 takes no new phases" is a
 * decision about phases, not about columns. A column added there between now
 * and go-live would otherwise be dropped in silence, and discovered as missing
 * data months later with the source database long since retired.
 *
 * Three kinds of drift, all fatal, because none of them has a safe default:
 *
 *  - **An unknown column** on a table the plan reads. The plan accounts for
 *    every column deliberately, so a column it does not name is one nobody has
 *    decided about. It may need importing or it may need a `drop` with a
 *    reason; the script cannot tell which, and guessing either way is wrong.
 *  - **A missing column** the plan reads. Either v1 removed it or the plan
 *    misspelt it. The second is the common case and produces an import that
 *    writes NULL over real data.
 *  - **An undeclared table.** Same argument as an unknown column, one level up.
 *    `facebook_group_config` is correctly dropped and would have been a silent
 *    bug to drop by accident, so exclusions are declared and silence is drift.
 *
 * It also checks the opposite direction for the three tables v1's own schema
 * doc describes but no migration ever created. If one of those turns up, the
 * reading behind `invites.guest_rsvp_id` being written as NULL is out of date.
 */

export interface SourceColumn {
  readonly table: string;
  readonly column: string;
}

export interface PreflightFinding {
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export interface PreflightResult {
  readonly findings: readonly PreflightFinding[];
  readonly ok: boolean;
}

/**
 * Checks `actual` — every (table, column) pair in the source database, as
 * `information_schema.columns` reports them — against the plan.
 *
 * Pure, so the whole of this reasoning is unit-testable without a database:
 * the caller does the one query and hands the rows in.
 */
export function preflight(actual: readonly SourceColumn[]): PreflightResult {
  const findings: PreflightFinding[] = [];

  const actualByTable = new Map<string, Set<string>>();
  for (const { table, column } of actual) {
    let columns = actualByTable.get(table);
    if (!columns) {
      columns = new Set();
      actualByTable.set(table, columns);
    }
    columns.add(column);
  }

  const planned = new Map(TABLE_PLANS.map((plan) => [plan.source, plan]));
  const excluded = new Map(EXCLUDED_TABLES.map((entry) => [entry.source, entry]));

  // Tables the plan reads.
  for (const [source, plan] of planned) {
    const columns = actualByTable.get(source);
    if (!columns) {
      findings.push({
        severity: 'error',
        message:
          `Source table "${source}" is in the import plan but does not exist in the source ` +
          'database. Either the connection points at the wrong database, or v1 dropped it.',
      });
      continue;
    }

    const expected = new Set(expectedSourceColumns(plan));

    for (const column of columns) {
      if (!expected.has(column)) {
        findings.push({
          severity: 'error',
          message:
            `${source}.${column} exists in the source database and the import plan does not ` +
            'account for it. Add a rule for it: copy it, remap it, or drop it with a reason. ' +
            'Leaving it unaccounted for means the import silently discards it.',
        });
      }
    }

    for (const column of expected) {
      if (!columns.has(column)) {
        findings.push({
          severity: 'error',
          message:
            `${source}.${column} is in the import plan but not in the source database. ` +
            'Either v1 removed it, or the plan misspells it — the second writes NULL over ' +
            'real data.',
        });
      }
    }
  }

  // Tables the plan deliberately skips, and the three it expects to be absent.
  for (const [source, entry] of excluded) {
    const exists = actualByTable.has(source);
    if (entry.expectedAbsent && exists) {
      findings.push({
        severity: 'error',
        message:
          `Source table "${source}" exists, and this import was written on the finding that ` +
          'it never did — no v1 migration creates it and no v1 code reads it. It needs a ' +
          'decision rather than a default: see EXCLUDED_TABLES.',
      });
    }
    if (!entry.expectedAbsent && !exists) {
      // Not fatal: a table that is excluded anyway being absent changes nothing
      // about what gets imported. Worth a line, because it usually means the
      // connection is pointed somewhere unexpected.
      findings.push({
        severity: 'warning',
        message:
          `Excluded source table "${source}" does not exist. Nothing depends on it; this is ` +
          'only worth checking if other tables are missing too.',
      });
    }
  }

  // Anything in the source database that nobody has classified.
  for (const table of actualByTable.keys()) {
    if (planned.has(table) || excluded.has(table)) continue;
    findings.push({
      severity: 'error',
      message:
        `Source table "${table}" is neither in the import plan nor declared as excluded. ` +
        'Classify it in one or the other — an unclassified table looks exactly like one ' +
        'somebody forgot.',
    });
  }

  return { findings, ok: !findings.some((f) => f.severity === 'error') };
}

/** The findings as lines for the console, errors first. */
export function formatPreflight(result: PreflightResult): string {
  if (result.findings.length === 0) {
    return 'Preflight: source schema matches the import plan exactly.';
  }
  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  const lines = [
    `Preflight: ${errors.length} error(s), ${warnings.length} warning(s).`,
    ...errors.map((f) => `  ERROR   ${f.message}`),
    ...warnings.map((f) => `  warning ${f.message}`),
  ];
  return lines.join('\n');
}
