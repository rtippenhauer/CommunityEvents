import {
  Component,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { debounceTime, distinctUntilChanged, Subject, switchMap } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  AttendanceEntry,
  EventCommentsService,
  MemberSearchResult,
} from '../../../core/services/event-comments.service';
import { FacebookAccountsService } from '../../../core/services/facebook-accounts.service';

export interface AttendanceDialogData {
  eventId: number;
}

@Component({
  selector: 'app-attendance-dialog',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title><mat-icon>how_to_reg</mat-icon> Attendance</h2>
    <mat-dialog-content>
      @if (attendanceLoading()) {
        <div class="att-loading"><mat-spinner diameter="24" /></div>
      } @else if (attendanceList().length === 0) {
        <p class="no-attendance">No Going RSVPs for this event.</p>
      } @else {
        <div class="attendance-list">
          @for (
            entry of attendanceList();
            track rowKey(entry)
          ) {
            <div
              class="attendance-row"
              [class.att-guest-row]="entry.type === 'guest'"
              [class.att-facebook-row]="entry.type === 'facebook'"
            >
              <span class="att-name">
                {{ entry.memberName }}
                @if (entry.isWalkin) {
                  <span class="walkin-badge">Walk-in</span>
                }
                @if (entry.type === 'guest') {
                  <span class="guest-badge">Guest</span>
                  @if (!entry.linkUsed) {
                    <span class="guest-pending-badge">Link not used</span>
                  }
                }
                <!-- v2-29. The source badge answers "why is this person
                     here", which is a real question once a mirror can add
                     somebody: a member marked Going by the sync never
                     pressed anything on the website. 'member' is the
                     ordinary case and is deliberately unbadged. -->
                @if (entry.type === 'facebook') {
                  <span class="fb-badge">Facebook</span>
                  @if (entry.plusOnes) {
                    <span class="att-plus-ones">+{{ entry.plusOnes }}</span>
                  }
                }
                @if (entry.type === 'member' && entry.source === 'facebook_sync') {
                  <span class="fb-badge" matTooltip="Marked Going by the Facebook sync">
                    via Facebook
                  </span>
                }
                @if (entry.type === 'member' && entry.source === 'admin') {
                  <span class="guest-badge" matTooltip="An organizer added them">
                    Added by organizer
                  </span>
                }
              </span>
              @if (entry.type === 'member') {
                <label class="att-out-of-town">
                  <input
                    type="checkbox"
                    [checked]="entry.fromOtherCity"
                    (change)="setFromOtherCity(entry.userId!, $any($event.target).checked)"
                  />
                  Out of town
                </label>
                <div class="att-btns">
                  <button
                    mat-stroked-button
                    [class.att-yes]="entry.attended === true"
                    (click)="setAttended(entry.userId!, true)"
                  >
                    <mat-icon>check</mat-icon> Attended
                  </button>
                  <button
                    mat-stroked-button
                    [class.att-no]="entry.attended === false"
                    (click)="setAttended(entry.userId!, false)"
                  >
                    <mat-icon>close</mat-icon> No-show
                  </button>
                </div>
              } @else if (entry.type === 'facebook') {
                <div class="att-btns">
                  <button
                    mat-stroked-button
                    [class.att-yes]="entry.attended === true"
                    (click)="setFacebookAttended(entry, true)"
                  >
                    <mat-icon>check</mat-icon> Attended
                  </button>
                  <button
                    mat-stroked-button
                    [class.att-no]="entry.attended === false"
                    (click)="setFacebookAttended(entry, false)"
                  >
                    <mat-icon>close</mat-icon> No-show
                  </button>
                </div>
              } @else {
                <div class="att-btns">
                  <button
                    mat-stroked-button
                    [class.att-yes]="entry.attended === true"
                    (click)="setGuestAttended(entry.guestLinkId!, true)"
                  >
                    <mat-icon>check</mat-icon> Attended
                  </button>
                  <button
                    mat-stroked-button
                    [class.att-no]="entry.attended === false"
                    (click)="setGuestAttended(entry.guestLinkId!, false)"
                  >
                    <mat-icon>close</mat-icon> No-show
                  </button>
                  @if (entry.recipientEmail) {
                    <button
                      mat-icon-button
                      matTooltip="Resend invite email"
                      (click)="resendGuestInvite(entry.guestLinkId!)"
                    >
                      <mat-icon>send</mat-icon>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>

        @if (showWalkinForm()) {
          <div class="walkin-form" #walkinFormEl>
            <mat-form-field appearance="outline" class="walkin-search-field">
              <mat-label>
                {{ addMode() === 'going' ? 'Add to Going — search' : 'Add walk-in — search' }}
              </mat-label>
              <input
                matInput
                [value]="walkinSearch()"
                (input)="onWalkinSearchInput($any($event.target).value)"
                autocomplete="off"
              />
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>
            @if (walkinResults().length > 0) {
              <div class="walkin-results" #walkinResultsEl>
                @for (m of walkinResults(); track m.id) {
                  <button
                    mat-button
                    class="walkin-result-row"
                    (click)="selectWalkin(m)"
                    [disabled]="addingWalkin()"
                  >
                    <mat-icon>person</mat-icon> {{ m.fullName }}
                  </button>
                }
              </div>
            }
          </div>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!attendanceLoading() && attendanceList().length > 0) {
        <button mat-stroked-button (click)="openWalkinForm('walkin')">
          <mat-icon>person_add</mat-icon> Add Walk-in
        </button>
        <!-- v2-29. Same member search, different outcome: a walk-in is somebody
             who turned up unannounced, while Add to Going records that they
             are coming. It skips the RSVP cutoff and the membership gate,
             because those govern what a member may do to their own RSVP and
             this dialog is open precisely after the cutoff has passed. -->
        <button mat-stroked-button (click)="openWalkinForm('going')">
          <mat-icon>event_available</mat-icon> Add to Going
        </button>
      }
      <button mat-button mat-dialog-close>Close</button>
      @if (!attendanceLoading() && attendanceList().length > 0) {
        <button
          mat-raised-button
          color="primary"
          (click)="saveAttendance()"
          [disabled]="savingAttendance()"
        >
          @if (savingAttendance()) {
            <mat-spinner diameter="16" />
          }
          Save Attendance
        </button>
      }
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      mat-dialog-content {
        min-width: 320px;
      }
      .att-loading {
        display: flex;
        justify-content: center;
        padding: 16px;
      }
      .no-attendance {
        color: #999;
        font-size: 0.9rem;
        margin: 0;
      }
      .attendance-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .attendance-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        padding: 8px;
        border-bottom: 1px solid #f0ebe3;
      }
      .att-name {
        font-size: 0.95rem;
        font-weight: 500;
        color: var(--ce-chrome);
        flex: 1;
      }
      .att-out-of-town {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.8rem;
        color: #555;
        white-space: nowrap;
      }
      .att-btns {
        display: flex;
        gap: 8px;
      }
      .att-yes {
        border-color: #2e7d32 !important;
        color: #2e7d32 !important;
        background: #e8f5e9 !important;
      }
      .att-no {
        border-color: #c62828 !important;
        color: #c62828 !important;
        background: #ffebee !important;
      }
      .walkin-badge,
      .guest-badge,
      .guest-pending-badge,
      /* v2-29. Added to the shared rule rather than restyled: these two only
         declared colours, so they rendered as a coloured text run flush
         against the name instead of as chips. Found by looking at the dialog,
         not by reading it. */
      .fb-badge,
      .att-plus-ones {
        display: inline-block;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        padding: 1px 6px;
        border-radius: 8px;
        margin-left: 6px;
      }
      .walkin-badge {
        background: #fff3e0;
        color: var(--ce-primary-hover, #b8832e);
      }
      .guest-badge {
        background: #e3f2fd;
        color: #1565c0;
      }
      .guest-pending-badge {
        background: #fce4ec;
        color: #c62828;
      }
      .att-guest-row {
        background: #fafcff;
        border-radius: 4px;
        padding-left: 6px;
      }
      /* Facebook blue is a third-party brand colour, one of the deliberate
         exceptions CLAUDE.md names to the "no colour literals" rule: it means
         "this came from Facebook" and must not follow a community's palette.
         White on #1877F2 is Facebook's own pairing and clears AA at 4.6:1. */
      .fb-badge {
        background: #1877f2;
        color: #fff;
      }
      .att-facebook-row {
        background: #f3f8ff;
        border-radius: 4px;
        padding-left: 6px;
      }
      .att-plus-ones {
        background: var(--ce-surface-variant);
        color: var(--ce-text-muted);
      }
      .walkin-form {
        margin-top: 12px;
        border-top: 1px dashed var(--ce-rule);
        padding-top: 12px;
      }
      .walkin-search-field {
        width: 100%;
      }
      .walkin-results {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 180px;
        overflow-y: auto;
      }
      .walkin-result-row {
        justify-content: flex-start;
      }
    `,
  ],
})
export class AttendanceDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AttendanceDialogComponent>);
  private readonly commentsService = inject(EventCommentsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly facebookAccounts = inject(FacebookAccountsService);
  readonly data = inject<AttendanceDialogData>(MAT_DIALOG_DATA);

  readonly attendanceList = signal<AttendanceEntry[]>([]);
  readonly attendanceLoading = signal(false);
  readonly savingAttendance = signal(false);
  readonly showWalkinForm = signal(false);
  readonly walkinSearch = signal('');
  readonly walkinResults = signal<MemberSearchResult[]>([]);
  readonly addingWalkin = signal(false);
  /**
   * What the shared member search will do (v2-29).
   *
   * One search panel, two outcomes: a walk-in is somebody who turned up
   * unannounced, Add to Going records that they are coming. Keeping one panel
   * avoids two near-identical searches on a dialog that is already dense.
   */
  readonly addMode = signal<'walkin' | 'going'>('walkin');
  private readonly walkinSearch$ = new Subject<string>();

  private readonly walkinFormEl = viewChild<ElementRef<HTMLElement>>('walkinFormEl');
  private readonly walkinResultsEl = viewChild<ElementRef<HTMLElement>>('walkinResultsEl');

  constructor() {
    this.walkinSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => this.commentsService.searchMembers(this.data.eventId, q)),
      )
      .subscribe((results) => this.walkinResults.set(results));
    this.loadAttendance();

    effect(() => {
      if (this.showWalkinForm()) {
        this.walkinFormEl()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    effect(() => {
      if (this.walkinResults().length > 0) {
        this.walkinResultsEl()?.nativeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    });
  }

  private loadAttendance(): void {
    this.attendanceLoading.set(true);
    this.commentsService.getAttendance(this.data.eventId).subscribe({
      next: (list) => {
        this.attendanceList.set(list);
        this.attendanceLoading.set(false);
      },
      error: () => this.attendanceLoading.set(false),
    });
  }

  setAttended(userId: number, attended: boolean): void {
    this.attendanceList.update((list) =>
      list.map((e) => (e.userId === userId ? { ...e, attended } : e)),
    );
  }

  setFromOtherCity(userId: number, fromOtherCity: boolean): void {
    this.attendanceList.update((list) =>
      list.map((e) => (e.userId === userId ? { ...e, fromOtherCity } : e)),
    );
  }

  setGuestAttended(guestLinkId: number, attended: boolean): void {
    this.commentsService.markGuestAttendance(guestLinkId, attended).subscribe({
      next: () => {
        this.attendanceList.update((list) =>
          list.map((e) => (e.guestLinkId === guestLinkId ? { ...e, attended } : e)),
        );
      },
      error: () =>
        this.snackBar.open('Failed to update guest attendance', 'OK', { duration: 3000 }),
    });
  }

  resendGuestInvite(guestLinkId: number): void {
    this.commentsService.resendGuestInvite(guestLinkId).subscribe({
      next: () => this.snackBar.open('Invite resent!', 'OK', { duration: 2500 }),
      error: () => this.snackBar.open('Failed to resend invite', 'OK', { duration: 3000 }),
    });
  }

  onWalkinSearchInput(value: string): void {
    this.walkinSearch.set(value);
    this.walkinSearch$.next(value);
  }

  /**
   * A stable track key across the three row types.
   *
   * The ids come from different tables, so a bare id would collide -- member 3
   * and Facebook account 3 are different rows, and Angular would reuse the DOM
   * node of one for the other.
   */
  rowKey(entry: AttendanceEntry): string {
    if (entry.type === 'member') return 'm' + entry.userId;
    if (entry.type === 'guest') return 'g' + entry.guestLinkId;
    return 'f' + entry.facebookAccountId;
  }

  openWalkinForm(mode: 'walkin' | 'going'): void {
    // Re-pressing the same button closes the panel; pressing the other one
    // switches mode and leaves it open, which is what somebody who picked the
    // wrong button expects.
    if (this.showWalkinForm() && this.addMode() === mode) {
      this.showWalkinForm.set(false);
      return;
    }
    this.addMode.set(mode);
    this.showWalkinForm.set(true);
  }

  /**
   * Attendance for a Facebook-only person.
   *
   * Written immediately rather than batched into Save: these rows are not part
   * of the member/guest payload `saveAttendance` sends, and silently dropping
   * them at save time would be worse than a round trip per tap.
   */
  setFacebookAttended(entry: AttendanceEntry, attended: boolean): void {
    const accountId = entry.facebookAccountId;
    if (accountId === undefined) return;

    // Tapping the active state again clears it back to "not marked", which is
    // the third state and the way out of a mistaken tap.
    const next = entry.attended === attended ? null : attended;

    this.facebookAccounts.markAttendance(accountId, this.data.eventId, next).subscribe({
      next: () => {
        this.attendanceList.update((list) =>
          list.map((row) =>
            row.type === 'facebook' && row.facebookAccountId === accountId
              ? { ...row, attended: next }
              : row,
          ),
        );
      },
      error: () => {
        this.snackBar.open('Could not save that', 'OK', { duration: 3000 });
      },
    });
  }

  selectWalkin(member: MemberSearchResult): void {
    if (this.addMode() === 'going') {
      this.addToGoing(member);
      return;
    }

    this.addingWalkin.set(true);
    this.commentsService.addWalkin(this.data.eventId, member.id).subscribe({
      next: (entry) => {
        this.attendanceList.update((list) => {
          const existing = list.findIndex((e) => e.userId === entry.userId);
          if (existing >= 0) {
            const updated = [...list];
            updated[existing] = entry;
            return updated;
          }
          return [...list, entry];
        });
        this.showWalkinForm.set(false);
        this.walkinSearch.set('');
        this.walkinResults.set([]);
        this.addingWalkin.set(false);
        this.snackBar.open(`${member.fullName} added as walk-in`, 'OK', { duration: 3000 });
      },
      error: () => {
        this.addingWalkin.set(false);
        this.snackBar.open('Failed to add walk-in', 'OK', { duration: 3000 });
      },
    });
  }

  /**
   * An organiser putting an existing member on the Going list (v2-29).
   *
   * Reloads rather than patching the list in place: the API decides the row's
   * `source`, and an existing RSVP is moved to Going rather than replaced, so
   * guessing the resulting row here would sometimes be wrong.
   */
  private addToGoing(member: MemberSearchResult): void {
    this.addingWalkin.set(true);
    this.commentsService.addToGoing(this.data.eventId, member.id).subscribe({
      next: () => {
        this.showWalkinForm.set(false);
        this.walkinSearch.set('');
        this.walkinResults.set([]);
        this.addingWalkin.set(false);
        this.snackBar.open(`${member.fullName} added to Going`, 'OK', { duration: 3000 });
        this.loadAttendance();
      },
      error: (error: { error?: { message?: string } }) => {
        this.addingWalkin.set(false);
        this.snackBar.open(
          error.error?.message ?? 'Failed to add them to Going',
          'OK',
          { duration: 5000 },
        );
      },
    });
  }

  saveAttendance(): void {
    const attendances = this.attendanceList()
      .filter((e) => e.type === 'member' && e.attended !== null)
      .map((e) => ({
        userId: e.userId!,
        attended: e.attended as boolean,
        fromOtherCity: e.fromOtherCity,
      }));
    this.savingAttendance.set(true);
    this.commentsService.markAttendance(this.data.eventId, attendances).subscribe({
      next: () => {
        this.savingAttendance.set(false);
        this.snackBar.open('Attendance saved', 'OK', { duration: 2000 });
      },
      error: () => {
        this.savingAttendance.set(false);
        this.snackBar.open('Failed to save attendance', 'OK', { duration: 3000 });
      },
    });
  }
}
