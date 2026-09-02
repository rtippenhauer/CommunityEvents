# REQ-VALIDATE-01 — Member validation audit trail + attendance-triggered validation

**Project:** Community Events
**Area:** Membership / trust boundary
**Status:** Draft
**Depends on:** REQ-TENANT-01 (user tenant scoping).

## Summary

Adds a real audit trail for how a non-validated member becomes a full
member — currently there isn't one — and adds attendance marking as a
second path to validation alongside the existing moderator vouch.

## Background

The phases file originally described this item as extending an existing
moderator-vouch audit pattern (`validated_by`, `validated_at`). That
premise doesn't hold: `UsersService.validateMember()` only updates
`role`. No validator, no timestamp, no `AuditService` call — despite
`AuditService` being injected in that same class and used elsewhere in
it. There is no existing pattern to extend; this doc creates one.

## Requirements

### REQ-VALIDATE-01.1 — Schema

```prisma
model users {
  // ...existing fields...
  validatedBy      Int?                      @map("validated_by")
  validatedAt      DateTime?                 @map("validated_at") @db.DateTime(0)
  validationSource users_validation_source?  @map("validation_source")

  validator        users?   @relation("UserValidations", fields: [validatedBy], references: [id])
  // Required other half of the self-relation — Prisma rejects a
  // one-sided declaration. Not a queryable feature on its own, just
  // what makes `prisma validate` pass.
  validatedMembers users[]  @relation("UserValidations")
}

enum users_validation_source {
  vouch
  attendance
}
```

All three columns are nullable. **They stay null for every member already
validated before this ships** — there is no way to reconstruct who vouched
for them or when, and writing a fabricated value would be worse than an
honest gap. Every validation from this point forward, through either
path, populates all three.

### REQ-VALIDATE-01.2 — Retrofit the existing vouch path

`UsersService.validateMember()` is rewritten to:

- Set `role: 'member'`, `validatedBy: <acting admin/moderator id>`,
  `validatedAt: now()`, `validationSource: 'vouch'`
- Call `AuditService.log()` with the real `AuditLogParams` shape —
  `userId`, `action`, `entityType`, `entityId`, `metadata`, `ipAddress`
  (not `actorId`/`targetUserId`/`details`, which don't exist on it):
  ```typescript
  await this.auditService.log({
    userId: actingUserId,
    action: 'user_validated',
    entityType: 'user',
    entityId: targetUserId,
    metadata: { source: 'vouch' },
  });
  ```
- Reject (400) if the target is already validated, rather than silently
  overwriting an existing trail

**`AuditService.log()` needs to accept an optional transaction client.**
Both this path and 01.3 below write the validation and the audit entry
inside a `$transaction`; as it stands, `AuditService.log()` uses the
service's own Prisma client, so the audit write happens on a separate
connection outside the transaction. If the transaction rolls back, the
audit row survives, recording a validation that never took effect. This
is additive work on `AuditService` itself (an optional `tx` parameter it
passes through to its own write instead of `this.prisma`), not something
either call site can work around on its own — flagging it here since both
requirements need it.

### REQ-VALIDATE-01.3 — Attendance-triggered validation (new path)

Extends the existing attendance-marking endpoint — which is **bulk and
actor-less**, not a single-user call with an actor already threaded
through:

```typescript
// events.service.ts:1584, real signature —
markAttendance(eventId: number, attendances: { userId, attended, fromOtherCity? }[])
```

called from the controller as `markAttendance(id, dto.attendances)`, with
no actor parameter today. This item adds `validateMember` per array
element (not on a single top-level DTO — there's no single target user),
and threads the acting admin/moderator in via `@CurrentUser`, which the
controller doesn't currently pass through:

```typescript
export class AttendanceItemDto {
  userId: number;
  attended: boolean;
  fromOtherCity?: boolean; // see REQ-CITIES-01 note below — meaning
                            // depends on whether the tenant has cities on
  validateMember?: boolean; // meaningful only when attended=true and
                             // the target is non_validated
}
```

```typescript
async markAttendance(
  eventId: number,
  attendances: AttendanceItemDto[],
  markedBy: UserContext, // additive — not threaded through today, see above
): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    for (const item of attendances) {
      await tx.event_rsvps.update({
        where: { eventId_userId: { eventId, userId: item.userId } },
        data: { attended: item.attended, fromOtherCity: item.fromOtherCity },
      });

      if (item.attended && item.validateMember) {
        const user = await tx.users.findUniqueOrThrow({ where: { id: item.userId } });
        if (user.role !== 'non_validated') {
          throw new BadRequestException(`User ${item.userId} is already validated.`);
        }
        await tx.users.update({
          where: { id: item.userId },
          data: {
            role: 'member',
            validatedBy: markedBy.id,
            validatedAt: new Date(),
            validationSource: 'attendance',
          },
        });
        // tx passed through — see the transaction-boundary note under
        // 01.2. Without it, this write escapes the transaction above.
        await this.auditService.log(
          {
            userId: markedBy.id,
            action: 'user_validated',
            entityType: 'user',
            entityId: item.userId,
            metadata: { source: 'attendance', eventId },
          },
          tx,
        );
      }
    }
  });
}
```

### REQ-VALIDATE-01.4 — Frontend

Attendance-marking UI gets a "Validate this member" checkbox, shown only
for non-validated attendees, visible alongside the existing attendance
checkbox. Per REQ-CITIES-01's decision on `fromOtherCity`: this form
shows the cross-city indicator only when the tenant's cities feature is
on; when it's off, that field isn't rendered or sent, not just hidden
with a stale default.

## Testing requirements

Per project convention (Vitest + Supertest):

- **Unit (Vitest):** `validateMember` rejects an already-validated target;
  attendance-triggered validation is a no-op unless `attended && validateMember`.
- **Integration (Supertest):** both paths correctly populate all three
  columns and produce an audit log entry; a member validated before this
  ships has all three columns null and is otherwise unaffected;
  attempting to validate an already-validated member via either path 400s;
  a forced rollback mid-transaction (e.g. a second `validateMember` call
  in the same batch failing its already-validated check) leaves **no**
  audit row for the failed item — proving the audit write is inside the
  transaction, not a separate connection that outlives it.

## Definition of done

- Both `validateMember()` (vouch) and attendance-triggered validation
  populate `validated_by`/`validated_at`/`validation_source` and log to
  `AuditService`, consistently
- Pre-existing validated members are left with null trail columns —
  documented as unknown, not backfilled
- Attendance marking presents a validate option for non-validated
  attendees only, and is a no-op for anyone already validated
