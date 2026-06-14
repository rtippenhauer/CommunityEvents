import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EventsService, Event } from '../../core/services/events.service';
import { AuthService } from '../../core/services/auth.service';
import { EventCardComponent } from '../../shared/components/event-card/event-card.component';

interface CalendarDay {
  day: number | null;
  dateStr: string | null;
  hasEvent: boolean;
  isToday: boolean;
}

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
    EventCardComponent,
  ],
  template: `
    <div class="calendar-page">
      <div class="page-header">
        <h2 class="page-title">Calendar</h2>
        <p class="page-sub">Browse upcoming and past DinnerBears events</p>
      </div>

      <div class="calendar-layout">

        <!-- Mini calendar -->
        <aside class="mini-cal">
          <div class="cal-nav">
            <button mat-icon-button (click)="prevMonth()" aria-label="Previous month">
              <mat-icon>chevron_left</mat-icon>
            </button>
            <span class="cal-month-label">{{ monthLabel() }}</span>
            <button mat-icon-button (click)="nextMonth()" aria-label="Next month">
              <mat-icon>chevron_right</mat-icon>
            </button>
          </div>

          <div class="cal-grid">
            @for (dow of DOW_LABELS; track dow) {
              <div class="cal-dow">{{ dow }}</div>
            }
            @for (cell of calendarDays(); track $index) {
              @if (cell.day === null) {
                <div class="cal-cell empty"></div>
              } @else {
                <button
                  class="cal-cell day"
                  [class.today]="cell.isToday"
                  [class.has-event]="cell.hasEvent"
                  [class.selected]="selectedDay() === cell.dateStr"
                  (click)="selectDay(cell.dateStr)"
                  [attr.aria-label]="cell.dateStr"
                >
                  {{ cell.day }}
                  @if (cell.hasEvent) { <span class="event-dot"></span> }
                </button>
              }
            }
          </div>

          <button mat-button class="today-btn" (click)="goToday()">Today</button>
          @if (isLoggedIn()) {
            <mat-checkbox [checked]="myOnly()" (change)="myOnly.set($event.checked)" class="my-only-check">My events only</mat-checkbox>
          }
        </aside>

        <!-- Event list -->
        <main class="event-list">
          @if (loading()) {
            <div class="list-loading"><mat-spinner diameter="36" /></div>
          } @else if (visibleEvents().length === 0) {
            <div class="list-empty">
              <mat-icon>event_busy</mat-icon>
              <p>No events in {{ monthLabel() }}.<br>Check back soon!</p>
            </div>
          } @else {
            @for (group of eventGroups(); track group.dateStr) {
              <div class="event-group" [id]="'day-' + group.dateStr">
                <div class="group-label">{{ group.dateStr | date:'EEEE, MMMM d' }}</div>
                <div class="group-cards">
                  @for (e of group.events; track e.id) {
                    <app-event-card [event]="e" [compact]="true" />
                  }
                </div>
              </div>
            }
          }
        </main>

      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .calendar-page {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 0 3rem;
    }

    .page-header {
      padding: 0 0 24px;
      border-bottom: 1px solid var(--db-cream-dark);
      margin-bottom: 28px;
    }

    .page-title {
      font-family: var(--db-font-display);
      font-size: 1.8rem;
      font-weight: 600;
      color: var(--db-brown-dark);
      margin: 0 0 4px;
    }

    .page-sub { font-size: 0.88rem; color: #888; margin: 0; }

    // ── Layout ───────────────────────────────────────────────────────────────

    .calendar-layout {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 32px;
      align-items: start;
    }

    // ── Mini Calendar ─────────────────────────────────────────────────────────

    .mini-cal {
      position: sticky;
      top: 80px;
      background: #fff;
      border: 1px solid #e8e0d6;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(61,28,5,0.07);
    }

    .cal-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .cal-month-label {
      font-weight: 700;
      font-size: 0.92rem;
      color: var(--db-brown-dark);
      letter-spacing: 0.01em;
    }

    .cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      margin-bottom: 10px;
    }

    .cal-dow {
      text-align: center;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #bbb;
      padding: 4px 0 6px;
    }

    .cal-cell {
      position: relative;
      aspect-ratio: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 0.78rem;
      border-radius: 50%;
      border: none;
      background: transparent;
      cursor: default;
      line-height: 1;
      padding: 0;

      &.day {
        cursor: pointer;
        font-weight: 500;
        color: var(--db-text-dark);
        transition: background 0.12s;
        &:hover { background: var(--db-cream-dark); }
      }

      &.today {
        background: var(--db-amber) !important;
        color: #fff !important;
        font-weight: 700;
      }

      &.has-event:not(.today) { color: var(--db-brown-dark); font-weight: 700; }

      &.selected:not(.today) {
        background: var(--db-cream-dark);
        outline: 2px solid var(--db-amber);
        outline-offset: -2px;
      }

      &.empty { cursor: default; }
    }

    .event-dot {
      position: absolute;
      bottom: 3px;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--db-amber);
    }

    .today-btn {
      width: 100%;
      font-size: 0.78rem;
      color: var(--db-amber) !important;
    }

    .my-only-check {
      display: flex;
      width: 100%;
      font-size: 0.78rem;
      margin-top: 4px;
      padding: 0 2px;
    }

    // ── Event list ────────────────────────────────────────────────────────────

    .event-list { min-height: 200px; }

    .list-loading, .list-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 240px;
      gap: 12px;
      color: #999;
      text-align: center;
      mat-icon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; }
      p { line-height: 1.6; }
    }

    .event-group { margin-bottom: 28px; }

    .group-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #aaa;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #f0ece4;
    }

    .group-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 14px;
    }

    @media (max-width: 768px) {
      .calendar-layout {
        grid-template-columns: 1fr;
      }
      .mini-cal { position: static; }
      .group-cards { grid-template-columns: 1fr; }
    }
  `],
})
export class CalendarComponent implements OnInit {
  private readonly eventsService = inject(EventsService);
  private readonly authService = inject(AuthService);

  readonly DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  readonly allEvents = signal<Event[]>([]);
  readonly loading = signal(true);
  readonly myOnly = signal(false);

  private readonly today = new Date();
  readonly viewYear = signal(this.today.getFullYear());
  readonly viewMonth = signal(this.today.getMonth()); // 0-indexed

  readonly selectedDay = signal<string | null>(null);

  readonly monthLabel = computed(() => {
    return new Date(this.viewYear(), this.viewMonth(), 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });

  readonly monthEvents = computed(() => {
    const prefix = this.monthPrefix();
    return this.allEvents().filter((e) => {
      if (!e.eventDate.startsWith(prefix)) return false;
      if (this.myOnly()) return e.myRsvpStatus === 'going' || e.myRsvpStatus === 'maybe';
      return true;
    });
  });

  readonly visibleEvents = computed(() => {
    const day = this.selectedDay();
    if (day) return this.monthEvents().filter((e) => e.eventDate === day);
    // When viewing the current month with no day selected, hide past events
    const t = this.today;
    const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (this.viewYear() === t.getFullYear() && this.viewMonth() === t.getMonth()) {
      return this.monthEvents().filter((e) => e.eventDate >= todayStr);
    }
    return this.monthEvents();
  });

  readonly eventGroups = computed(() => {
    const map = new Map<string, Event[]>();
    for (const e of this.visibleEvents()) {
      const arr = map.get(e.eventDate) ?? [];
      arr.push(e);
      map.set(e.eventDate, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateStr, events]) => ({ dateStr, events: events.sort((a, b) => a.eventTime.localeCompare(b.eventTime)) }));
  });

  readonly calendarDays = computed<CalendarDay[]>(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = this.todayStr();
    const eventDates = new Set(this.monthEvents().map((e) => e.eventDate));

    const cells: CalendarDay[] = [];

    for (let i = 0; i < firstDow; i++) {
      cells.push({ day: null, dateStr: null, hasEvent: false, isToday: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        day: d,
        dateStr,
        hasEvent: eventDates.has(dateStr),
        isToday: dateStr === todayStr,
      });
    }

    return cells;
  });

  ngOnInit(): void {
    this.eventsService.getAll({}).subscribe({
      next: (evts) => { this.allEvents.set(evts); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  prevMonth(): void {
    const m = this.viewMonth();
    if (m === 0) { this.viewYear.update((y) => y - 1); this.viewMonth.set(11); }
    else { this.viewMonth.set(m - 1); }
    this.selectedDay.set(null);
  }

  nextMonth(): void {
    const m = this.viewMonth();
    if (m === 11) { this.viewYear.update((y) => y + 1); this.viewMonth.set(0); }
    else { this.viewMonth.set(m + 1); }
    this.selectedDay.set(null);
  }

  goToday(): void {
    this.viewYear.set(this.today.getFullYear());
    this.viewMonth.set(this.today.getMonth());
    this.selectedDay.set(null);
  }

  selectDay(dateStr: string | null): void {
    if (!dateStr) return;
    this.selectedDay.set(this.selectedDay() === dateStr ? null : dateStr);

    // Scroll to the event group if it exists
    setTimeout(() => {
      document.getElementById(`day-${dateStr}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  isLoggedIn(): boolean { return this.authService.isLoggedIn(); }

  private monthPrefix(): string {
    return `${this.viewYear()}-${String(this.viewMonth() + 1).padStart(2, '0')}`;
  }

  private todayStr(): string {
    const d = this.today;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
