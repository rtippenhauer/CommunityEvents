import { copy, custom, fk, type TablePlan } from '../plan-types';

/**
 * Achievements, points, announcements, feedback, moderation and the audit log
 * (REQ-IMPORT-01.3).
 *
 * Last group, because everything here points at a user, an event or both and
 * nothing points back.
 */

/**
 * The community's own achievement catalogue, imported with its keys intact.
 *
 * **The keys are the reason this is a straight insert and not a merge.** An
 * achievement's `key` is an identifier joined on in code, not copy, so
 * `member_achievements` only resolves if v1's catalogue rows keep theirs. The
 * import creates the tenant bare — see `createTenant` — precisely so there is
 * no seeded catalogue here to collide with on `(tenant_id, key)`.
 *
 * It also means the community keeps *its* copy, titles and icons rather than
 * the platform's defaults, which is what the catalogue being scoped is for.
 */
export const achievementsPlan: TablePlan = {
  source: 'achievements',
  model: 'achievements',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    key: copy('key'),
    name: copy('name'),
    description: copy('description'),
    icon: copy('icon'),
    image_path: copy('imagePath'),
    progress_type: copy('progressType'),
    progress_target: copy('progressTarget'),
    // The secret-dinner achievements point at the specific event that earned
    // them, so this must come after events.
    event_id: fk('eventId', 'events', false),
    points: copy('points'),
    title: copy('title'),
    is_secret: copy('isSecret'),
    created_at: copy('createdAt'),
  },
  note: 'After events: a secret-dinner achievement names the event that earned it.',
};

export const memberAchievementsPlan: TablePlan = {
  source: 'member_achievements',
  model: 'member_achievements',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    member_id: fk('memberId', 'users', true),
    achievement_id: fk('achievementId', 'achievements', true),
    earned_at: copy('earnedAt'),
    seen_at: copy('seenAt'),
  },
};

/**
 * The Bear Points ledger — every award, not a total.
 *
 * REQ-IMPORT-01.3 is explicit that the full ledger imports rather than current
 * balances, because auditability was the point of the ledger design. The
 * leaderboard is derived from it and is not imported.
 *
 * `reference_id` is deliberately **not** remapped: it is a polymorphic pointer
 * whose meaning depends on `point_type` (an event for attendance, a rating, a
 * comment), with no column saying which table. Remapping it would mean
 * switching on `point_type` and silently writing a wrong id for any value this
 * code does not know — so it keeps v1's id, which is a stale reference rather
 * than a wrong one, and the points themselves are what the ledger is for.
 */
export const memberPointsPlan: TablePlan = {
  source: 'member_points',
  model: 'member_points',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', true),
    point_type: copy('pointType'),
    reference_id: copy('referenceId'),
    points: copy('points'),
    awarded_at: copy('awardedAt'),
  },
  note: 'Full ledger per REQ-IMPORT-01.3; reference_id keeps v1 ids (polymorphic, see comment).',
};

export const customIconsPlan: TablePlan = {
  source: 'custom_icons',
  model: 'custom_icons',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    name: copy('name'),
    image_path: copy('imagePath'),
    created_by: fk('createdBy', 'users', false),
    created_at: copy('createdAt'),
  },
  note: 'The icon library achievements draw on. No FK from achievements — matched by path.',
};

export const announcementsPlan: TablePlan = {
  source: 'announcements',
  model: 'announcements',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    title: copy('title'),
    body: copy('body'),
    city_id: fk('cityId', 'cities', false),
    status: copy('status'),
    published_at: copy('publishedAt'),
    created_by: fk('createdBy', 'users', false),
    created_at: copy('createdAt'),
    updated_at: copy('updatedAt'),
  },
  note: "Before announcement_comments; users.last_seen_announcement_id is backfilled after.",
};

export const announcementCommentsPlan: TablePlan = {
  source: 'announcement_comments',
  model: 'announcement_comments',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    announcement_id: fk('announcementId', 'announcements', true),
    user_id: fk('userId', 'users', true),
    body: copy('body'),
    edited_at: copy('editedAt'),
    created_at: copy('createdAt'),
    deleted_at: copy('deletedAt'),
  },
};

/**
 * v1's one feedback table, split across v2's two (Rob, 2026-11-07).
 *
 * v2 draws the line at a table boundary: what is about the *product* lives in
 * the global `system_reports`, what is about a *community* stays in the scoped
 * `feedback`. v1 made no such distinction — one table with a `category` of
 * `bug | feature_request | comment` — so the categories are what route the row.
 *
 * **This split loses things, and they are named here rather than discovered
 * later.** `system_reports` has no notes table, no upvotes table, and no
 * `is_private`, `release_note`, `upvote_count` or `seen_at` column. So for a
 * bug or feature request: its threaded notes and its upvotes are skipped and
 * counted (`feedback_notes`/`feedback_upvotes` find no mapping, which is the
 * mechanism, not an accident), and four columns are dropped. The dry run
 * reports the exact numbers before anything is written, which is the point of
 * running it first.
 *
 * Comments keep everything, because the scoped `feedback` table is unchanged
 * from v1's shape.
 */
export const feedbackPlan: TablePlan = {
  source: 'feedback',
  model: 'feedback',
  idMapNames: ['feedback', 'system_reports'],
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', true),
    title: copy('title'),
    category: copy('category'),
    body: copy('body'),
    status: copy('status'),
    admin_note: copy('adminNote'),
    release_note: custom('Dropped for bugs/feature requests: system_reports has no such column.'),
    is_private: custom('Dropped for bugs/feature requests: system_reports has no such column.'),
    upvote_count: custom('Dropped for bugs/feature requests: system_reports has no such column.'),
    seen_at: custom('Dropped for bugs/feature requests: system_reports has no such column.'),
    resolved_at: copy('resolvedAt'),
    created_at: copy('createdAt'),
    updated_at: copy('updatedAt'),
  },
  transform: (row, ctx) => {
    const category = row['category'];
    const isProductReport = category === 'bug' || category === 'feature_request';

    if (!isProductReport) {
      // A community comment. Stays in the scoped table, which still carries
      // every one of v1's columns, so the rules above cover it unchanged.
      return {
        action: 'write',
        data: {
          releaseNote: row['release_note'],
          isPrivate: row['is_private'],
          upvoteCount: row['upvote_count'],
          seenAt: row['seen_at'],
          // v2 added attachments as files rather than markup. v1's feedback
          // table has no screenshots column at all, so there is nothing to
          // carry and nothing was lost: v1 served no `/api/uploads/feedback`
          // prefix either, so an image embedded in a body was already broken
          // there. (REQ-IMPORT-01's "check before import", answered.)
          screenshots: null,
        },
      };
    }

    // A bug or feature request. `system_reports` is global, and `title` is NOT
    // NULL there where v1 allows it to be null — so a row with no title gets
    // one from its own body rather than being skipped. Losing a member's report
    // over a missing title would be a worse outcome than a generated one.
    const title = typeof row['title'] === 'string' && row['title'].trim() !== '' ? row['title'] : null;
    const body = typeof row['body'] === 'string' ? row['body'] : '';

    ctx.note(
      `feedback#${String(row['id'])} (${String(category)}) -> system_reports: ` +
        'notes, upvotes and is_private/release_note/upvote_count/seen_at are not carried.',
    );

    return {
      action: 'write',
      model: 'system_reports',
      idMapName: 'system_reports',
      data: {
        category,
        title: title ?? deriveTitle(body),
        body,
        status: row['status'],
        adminNote: row['admin_note'],
        resolvedAt: row['resolved_at'],
        createdAt: row['created_at'],
        updatedAt: row['updated_at'],
        // Who reported it and from where. `system_reports` is global, so the
        // tenant is a column rather than something the scoping injects — and
        // `reported_by_tenant_id` is how the report is still attributable to
        // this community after the fact.
        reportedByUserId: ctx.ids.resolve('users', Number(row['user_id']), 'system_reports.reported_by_user_id'),
        reportedByTenantId: ctx.tenantId,
        // v1 has no equivalent: the link to the release a report shipped in is
        // where v2 credits a contributor, and v1 recorded that as free text in
        // `release_note`, which does not survive the split.
        shippedInReleaseId: null,
        screenshots: null,
      },
    };
  },
  note: 'Splits by category: comment -> feedback (scoped), bug/feature_request -> system_reports (global).',
};

/**
 * First line of the body, as a title for a report that had none.
 *
 * `system_reports.title` is NOT NULL and capped at 200 characters; v1's
 * `feedback.title` is nullable. Truncated on a word boundary where one is
 * available, because a title cut mid-word reads as corrupted data rather than
 * as a summary.
 */
function deriveTitle(body: string): string {
  const firstLine = body.split('\n')[0].trim();
  const flat = (firstLine === '' ? body.trim() : firstLine).replace(/\s+/g, ' ');
  if (flat === '') return '(no title)';
  if (flat.length <= 200) return flat;
  const cut = flat.slice(0, 200);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 120 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Notes and upvotes, which exist only for rows that stayed in `feedback`.
 *
 * Both resolve their parent against the `feedback` map, so a note on a ticket
 * that became a `system_reports` row finds nothing and is skipped with a
 * reason. That is the split's cost, made visible by the mechanism rather than
 * by a special case somebody has to maintain.
 */
export const feedbackNotesPlan: TablePlan = {
  source: 'feedback_notes',
  model: 'feedback_notes',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    feedback_id: fk('feedbackId', 'feedback', true),
    author_id: fk('authorId', 'users', true),
    content: copy('content'),
    is_admin_only: copy('isAdminOnly'),
    created_at: copy('createdAt'),
  },
  note: 'Skipped where the parent ticket became a system_reports row — see feedbackPlan.',
};

export const feedbackUpvotesPlan: TablePlan = {
  source: 'feedback_upvotes',
  model: 'feedback_upvotes',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    feedback_id: fk('feedbackId', 'feedback', true),
    member_id: fk('memberId', 'users', true),
    created_at: copy('createdAt'),
  },
  note: 'Skipped where the parent ticket became a system_reports row — see feedbackPlan.',
};

/**
 * Moderation history, resolved and open alike.
 *
 * REQ-IMPORT-01.3 settles this as a confirmed default rather than an open
 * question: it is real moderation history, not a work queue, so a resolved
 * report is as much worth keeping as an open one.
 *
 * `content_id` is polymorphic in both tables — an announcement, a comment, a
 * reply or a rating, with `content_type` saying which — and is remapped on that
 * discriminator, which is the one place in this import where a polymorphic
 * pointer *can* be resolved safely, because the enum of types is closed and
 * every arm has a map. An unknown type leaves the id alone and reports it.
 */
export const contentReportsPlan: TablePlan = {
  source: 'content_reports',
  model: 'content_reports',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    reporter_id: fk('reporterId', 'users', true),
    content_type: copy('contentType'),
    content_id: custom('Remapped on content_type — see remapContentId.'),
    reason: copy('reason'),
    status: copy('status'),
    reviewed_by: fk('reviewedBy', 'users', false),
    reviewed_at: copy('reviewedAt'),
    created_at: copy('createdAt'),
  },
  transform: (row, ctx) => ({
    action: 'write',
    data: { contentId: remapContentId(row, ctx, 'content_reports') },
  }),
};

/**
 * v1's superseded per-module flags, which `content_reports` replaced in v1
 * itself (Phase 10.6) without the old rows being migrated.
 *
 * Imported because the table still holds rows and v2 still has the model. Same
 * polymorphic remapping as `content_reports`; in practice `content_type` is
 * only ever `announcement` here.
 */
export const contentFlagsPlan: TablePlan = {
  source: 'content_flags',
  model: 'content_flags',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    content_type: copy('contentType'),
    content_id: custom('Remapped on content_type — see remapContentId.'),
    reported_by: fk('reportedBy', 'users', true),
    reason: copy('reason'),
    status: copy('status'),
    reviewed_by: fk('reviewedBy', 'users', false),
    reviewed_at: copy('reviewedAt'),
    created_at: copy('createdAt'),
  },
  transform: (row, ctx) => ({
    action: 'write',
    data: { contentId: remapContentId(row, ctx, 'content_flags') },
  }),
};

/**
 * Which id map a `content_type` points into.
 *
 * Closed on purpose. An unrecognised type is reported rather than guessed,
 * because the alternative is a moderation report pointing at an unrelated row
 * of whichever table happened to be chosen.
 */
const CONTENT_TYPE_TABLES: Record<string, string> = {
  announcement: 'announcements',
  announcement_comment: 'announcement_comments',
  event_comment: 'event_comments',
  event_comment_reply: 'event_comment_replies',
  location_rating: 'location_ratings',
};

function remapContentId(
  row: Record<string, unknown>,
  ctx: { ids: import('../id-map').IdMap; note: (m: string) => void },
  usage: string,
): number | null {
  const contentType = String(row['content_type']);
  const contentId = Number(row['content_id']);
  const table = CONTENT_TYPE_TABLES[contentType];

  if (!table) {
    ctx.note(
      `${usage}#${String(row['id'])} has content_type "${contentType}", which this import ` +
        'does not know how to remap. content_id left as v1 wrote it.',
    );
    return contentId;
  }

  const mapped = ctx.ids.resolve(table, contentId, `${usage}.content_id (${contentType})`);
  if (mapped === undefined) {
    ctx.note(
      `${usage}#${String(row['id'])} reports ${contentType}#${contentId}, which was not ` +
        'imported. content_id left as v1 wrote it.',
    );
    return contentId;
  }
  return mapped;
}

/**
 * The immutable action log, attributed to remapped user ids.
 *
 * `entity_id` is polymorphic like the points ledger's `reference_id` and is
 * left as v1 wrote it for the same reason: `entity_type` is free text here
 * rather than a closed enum, so there is no set of arms to switch on. An audit
 * row's value is its action, actor and timestamp.
 */
export const auditLogPlan: TablePlan = {
  source: 'audit_log',
  model: 'audit_log',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', false),
    action: copy('action'),
    entity_type: copy('entityType'),
    entity_id: copy('entityId'),
    metadata: copy('metadata'),
    ip_address: copy('ipAddress'),
    created_at: copy('createdAt'),
  },
  note: 'entity_id keeps v1 ids: entity_type is free text, so there is nothing to switch on.',
};

/**
 * The community's email quota, counters and template ids — and, only if the run
 * explicitly asks for them, its credentials.
 *
 * **The allowance and the template ids belong to the Brevo account, not the
 * community**, and DinnerBears keeps the same account across cutover, so both
 * import: an inherited template id would otherwise address the wrong library.
 *
 * Credentials are gated on `--with-email-credentials` (default off) because the
 * rehearsal runs live member data on stage, where the whole point is that it
 * cannot mail real members. Note what the gate is *not* doing: it is not the
 * only guard. A tenant moved to a `*.stage.communityeventsproject.com` host
 * *gains* the ability to send by inheriting the deployment's env key, which
 * clearing its own key does not prevent — which is why stage's own keys come
 * out too (Rob, 2026-10-14). This gate stops the import handing a live
 * credential to a tenant that would otherwise have had none.
 *
 * `resend_overflow_enabled` is forced off with the credentials withheld, for a
 * specific reason: Resend is dormant by default, so a copied row arriving with
 * overflow switched on turns a dormant provider into a live one without anybody
 * enabling it.
 *
 * The three key columns are declared in `encrypted-columns.ts`, so they are
 * encrypted on write by the extension. This script never calls
 * `encryptSecret` itself.
 */
export const emailProviderConfigPlan: TablePlan = {
  source: 'email_provider_config',
  model: 'email_provider_config',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    brevo_enabled: copy('brevoEnabled'),
    resend_overflow_enabled: custom('Forced off unless --with-email-credentials.'),
    brevo_daily_limit: copy('brevoDailyLimit'),
    resend_daily_limit: copy('resendDailyLimit'),
    // The counters come across so the day's allowance is not silently doubled
    // by importing mid-day: the local counter and the account budget both have
    // to permit a send, and resetting one here would let this community mail
    // past what the account has left.
    brevo_sent_today: copy('brevoSentToday'),
    resend_sent_today: copy('resendSentToday'),
    last_reset_date: copy('lastResetDate'),

    brevo_api_key: custom('Credential: only with --with-email-credentials.'),
    resend_api_key: custom('Credential: only with --with-email-credentials.'),

    brevo_from_email: copy('brevoFromEmail'),
    brevo_from_name: copy('brevoFromName'),
    resend_from_email: copy('resendFromEmail'),
    resend_from_name: copy('resendFromName'),

    tmpl_invite: copy('tmplInvite'),
    tmpl_security_alert: copy('tmplSecurityAlert'),
    tmpl_event_published: copy('tmplEventPublished'),
    tmpl_rsvp_confirmation: copy('tmplRsvpConfirmation'),
    tmpl_event_reminder: copy('tmplEventReminder'),
    tmpl_account_deletion: copy('tmplAccountDeletion'),
    tmpl_reengagement_60: copy('tmplReengagement60'),
    tmpl_reengagement_90: copy('tmplReengagement90'),
    tmpl_guest_rsvp_confirmation: copy('tmplGuestRsvpConfirmation'),
    tmpl_email_verification: copy('tmplEmailVerification'),
    tmpl_password_reset: copy('tmplPasswordReset'),
    tmpl_provider_disconnected: copy('tmplProviderDisconnected'),
    tmpl_account_deleted: copy('tmplAccountDeleted'),

    updated_at: copy('updatedAt'),
  },
  transform: (row, ctx) => {
    if (!ctx.withEmailCredentials) {
      ctx.note(
        'email_provider_config imported WITHOUT credentials: brevo_api_key and ' +
          'resend_api_key are NULL and resend_overflow_enabled is off. Re-run with ' +
          '--with-email-credentials, or set the keys in Admin → Email, before this ' +
          'community can send.',
      );
      return {
        action: 'write',
        data: { brevoApiKey: null, resendApiKey: null, resendOverflowEnabled: false },
      };
    }
    ctx.note('email_provider_config imported WITH credentials — this tenant can send email.');
    return {
      action: 'write',
      data: {
        brevoApiKey: row['brevo_api_key'],
        resendApiKey: row['resend_api_key'],
        resendOverflowEnabled: row['resend_overflow_enabled'],
      },
    };
  },
};

/**
 * Meta's server-to-server deletion callbacks.
 *
 * Global in v2, because the callback arrives unauthenticated carrying no host a
 * tenant could be resolved from — so this is the one table in the import whose
 * rows do not belong to the new tenant. Its user pointer is still remapped,
 * which is the only thing that makes an old row meaningful.
 */
export const facebookDeletionRequestsPlan: TablePlan = {
  source: 'facebook_deletion_requests',
  model: 'facebook_deletion_requests',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    facebook_user_id: copy('facebookUserId'),
    confirmation_code: copy('confirmationCode'),
    dinnerbears_user_id: fk('dinnerbearsUserId', 'users', false),
    status: copy('status'),
    requested_at: copy('requestedAt'),
    completed_at: copy('completedAt'),
  },
  note: 'Global in v2 — the only imported table whose rows carry no tenant_id.',
};

