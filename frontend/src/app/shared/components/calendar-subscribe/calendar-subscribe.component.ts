import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-calendar-subscribe',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <a mat-stroked-button routerLink="/profile/calendar" class="cal-link">
      <mat-icon>event_note</mat-icon>
      Manage Calendar
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .cal-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85rem !important;
      }
    `,
  ],
})
export class CalendarSubscribeComponent {}
