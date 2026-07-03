import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

const ICON_NAMES: string[] = [
  'emoji_events', 'military_tech', 'workspace_premium', 'verified', 'badge', 'stars', 'star', 'grade',
  'thumb_up', 'favorite', 'favorite_border', 'celebration', 'festival', 'nightlife', 'new_releases',
  'auto_awesome', 'diamond', 'savings', 'paid', 'redeem', 'card_giftcard', 'loyalty',
  'local_activity', 'local_dining', 'restaurant', 'restaurant_menu', 'fastfood', 'ramen_dining',
  'dinner_dining', 'brunch_dining', 'breakfast_dining', 'bakery_dining', 'lunch_dining', 'takeout_dining',
  'local_pizza', 'local_bar', 'local_cafe', 'wine_bar', 'sports_bar', 'icecream', 'cake', 'liquor',
  'tapas', 'set_meal', 'kebab_dining', 'soup_kitchen', 'rice_bowl', 'egg', 'egg_alt', 'grill',
  'food_bank',
  'event', 'event_available', 'event_seat', 'event_note', 'calendar_today', 'calendar_month',
  'today', 'schedule', 'watch_later', 'history', 'history_edu',
  'people', 'person', 'person_add', 'group', 'group_add', 'groups', 'diversity_3', 'handshake',
  'forum', 'chat', 'comment', 'volunteer_activism', 'self_improvement',
  'travel_explore', 'flight', 'flight_takeoff', 'directions_car', 'hiking', 'explore', 'map',
  'place', 'location_on', 'public', 'language', 'luggage', 'backpack', 'hotel',
  'directions_boat', 'sailing', 'anchor', 'surfing', 'kayaking', 'terrain', 'landscape',
  'beach_access', 'downhill_skiing', 'snowboarding', 'golf_course',
  'lock', 'lock_open', 'key', 'shield', 'security',
  'home', 'house', 'cottage', 'apartment', 'storefront', 'store', 'business', 'corporate_fare',
  'school', 'book', 'menu_book', 'auto_stories',
  'music_note', 'headphones', 'mic', 'camera_alt', 'photo_camera', 'palette', 'brush',
  'theater_comedy',
  'sports_esports', 'sports_football', 'sports_soccer', 'sports_basketball', 'sports_baseball',
  'sports_tennis', 'sports_volleyball', 'sports_handball', 'sports_cricket', 'sports_rugby',
  'sports_hockey', 'sports_mma', 'sports_motorsports', 'fitness_center', 'directions_bike',
  'directions_run', 'directions_walk', 'pool', 'spa', 'accessibility', 'accessibility_new',
  'pets', 'cruelty_free', 'forest', 'park', 'nature', 'eco', 'local_florist',
  'whatshot', 'local_fire_department', 'bolt', 'flash_on', 'ac_unit', 'wb_sunny', 'nightlight',
  'cloud', 'sunny', 'umbrella',
  'rocket_launch', 'science', 'psychology', 'lightbulb',
  'mood', 'sentiment_very_satisfied', 'tag_faces',
  'check_circle', 'task_alt', 'done_all', 'assignment_turned_in', 'local_shipping',
];

@Component({
  selector: 'app-icon-picker',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <div class="icon-picker">
      <mat-icon class="icon-preview">{{ icon || 'emoji_events' }}</mat-icon>
      <mat-form-field appearance="outline" class="icon-search-field">
        <mat-label>{{ label }}</mat-label>
        <input matInput [(ngModel)]="query" (ngModelChange)="onQueryChange($event)"
          [matAutocomplete]="auto" autocomplete="off" placeholder="Search icons…" />
        <mat-autocomplete #auto="matAutocomplete" (optionSelected)="onSelect($event)">
          @for (name of filtered(); track name) {
            <mat-option [value]="name">
              <mat-icon class="option-icon">{{ name }}</mat-icon> {{ name }}
            </mat-option>
          }
        </mat-autocomplete>
      </mat-form-field>
    </div>
  `,
  styles: [`
    .icon-picker { display: flex; align-items: center; gap: 10px; }
    .icon-preview { font-size: 1.6rem; width: 1.6rem; height: 1.6rem; color: #C9933A; flex-shrink: 0; }
    .icon-search-field { flex: 1; min-width: 160px; }
    .option-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; vertical-align: middle; margin-right: 6px; color: #666; }
  `],
})
export class IconPickerComponent implements OnChanges {
  @Input() icon = '';
  @Input() label = 'Icon';
  @Output() iconChange = new EventEmitter<string>();

  query = '';

  readonly filtered = signal<string[]>(ICON_NAMES.slice(0, 40));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['icon'] && this.icon !== this.query) {
      this.query = this.icon;
    }
  }

  onQueryChange(value: string): void {
    this.query = value;
    this.iconChange.emit(value);
    const q = value.trim().toLowerCase();
    this.filtered.set(
      q ? ICON_NAMES.filter((n) => n.includes(q)).slice(0, 40) : ICON_NAMES.slice(0, 40),
    );
  }

  onSelect(event: MatAutocompleteSelectedEvent): void {
    const name = event.option.value as string;
    this.query = name;
    this.iconChange.emit(name);
  }
}
