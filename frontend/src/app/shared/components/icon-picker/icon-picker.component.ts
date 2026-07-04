import { Component, EventEmitter, inject, Input, OnChanges, OnInit, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommunityService, CustomIcon } from '../../../core/services/community.service';
import { PhotoCropDialogComponent } from '../photo-crop-dialog/photo-crop-dialog.component';
import { removeWhiteBackground } from '../../utils/remove-white-background';

const IMG_PREFIX = 'img:';

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
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <div class="icon-picker">
      @if (isImg(icon)) {
        <img class="icon-preview-img" [src]="srcFor(icon)" alt="" />
      } @else {
        <mat-icon class="icon-preview">{{ icon || 'emoji_events' }}</mat-icon>
      }
      <mat-form-field appearance="outline" class="icon-search-field">
        <mat-label>{{ label }}</mat-label>
        <input matInput [(ngModel)]="query" (ngModelChange)="onQueryChange($event)"
          [matAutocomplete]="auto" autocomplete="off" placeholder="Search icons or custom images…" />
        <mat-autocomplete #auto="matAutocomplete" (optionSelected)="onSelect($event)">
          @for (item of filteredCustomIcons(); track item.id) {
            <mat-option [value]="valueFor(item)">
              <img class="option-img" [src]="item.imagePath" alt="" />
              {{ item.name }}
              @if (item.usageCount > 0) {
                <span class="option-usage">· used by {{ item.usageCount }}</span>
              }
            </mat-option>
          }
          @for (name of filtered(); track name) {
            <mat-option [value]="name">
              <mat-icon class="option-icon">{{ name }}</mat-icon> {{ name }}
            </mat-option>
          }
        </mat-autocomplete>
      </mat-form-field>
      <button mat-icon-button type="button" matTooltip="Upload a custom icon"
        (click)="showUploadForm.set(!showUploadForm())">
        <mat-icon>add_photo_alternate</mat-icon>
      </button>
      <button mat-icon-button type="button" matTooltip="Manage custom icons"
        (click)="showManagePanel.set(!showManagePanel())">
        <mat-icon>collections</mat-icon>
      </button>
    </div>
    @if (isImg(icon) && currentUsage() !== null) {
      <p class="usage-hint">Used by {{ currentUsage() }} achievement{{ currentUsage() === 1 ? '' : 's' }}.</p>
    }
    @if (showUploadForm()) {
      <div class="icon-upload-form">
        <mat-form-field appearance="outline" class="upload-name-field">
          <mat-label>Icon name</mat-label>
          <input matInput [(ngModel)]="uploadName" placeholder="e.g. Chips &amp; Salsa" />
        </mat-form-field>
        <input #fileInput type="file" accept="image/*" hidden (change)="onUploadFileSelected($event)" />
        @if (uploadPreviewUrl) {
          <img class="upload-preview" [src]="uploadPreviewUrl" alt="" />
        }
        <button mat-stroked-button type="button" (click)="fileInput.click()">
          <mat-icon>upload</mat-icon> {{ uploadBlob ? 'Change Image' : 'Choose Image' }}
        </button>
        <button mat-raised-button color="primary" type="button"
          [disabled]="uploading() || !uploadName.trim() || !uploadBlob"
          (click)="doUpload()">
          @if (uploading()) { <mat-spinner diameter="16" /> } Add to Library
        </button>
        <button mat-button type="button" (click)="cancelUpload()">Cancel</button>
      </div>
    }
    @if (showManagePanel()) {
      <div class="icon-manage-panel">
        <div class="manage-panel-title">Custom Icon Library</div>
        @if (customIcons().length === 0) {
          <p class="manage-empty">No custom icons uploaded yet.</p>
        } @else {
          <div class="manage-list">
            @for (item of customIcons(); track item.id) {
              <div class="manage-row">
                <img class="manage-thumb" [src]="thumbSrc(item)" alt="" />
                <span class="manage-name">{{ item.name }}</span>
                <span class="manage-usage">{{ item.usageCount }} use{{ item.usageCount === 1 ? '' : 's' }}</span>
                <button mat-icon-button type="button"
                  [disabled]="reprocessingId() === item.id"
                  matTooltip="Remove white/checkered background"
                  (click)="reprocessIcon(item)">
                  @if (reprocessingId() === item.id) {
                    <mat-spinner diameter="18" />
                  } @else {
                    <mat-icon>auto_fix_high</mat-icon>
                  }
                </button>
                <button mat-icon-button type="button" color="warn"
                  [disabled]="item.usageCount > 0"
                  [matTooltip]="item.usageCount > 0 ? 'In use — change achievements using it before deleting' : 'Delete'"
                  (click)="deleteCustomIcon(item)">
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .icon-picker { display: flex; align-items: center; gap: 10px; }
    .icon-preview { font-size: 1.6rem; width: 1.6rem; height: 1.6rem; color: #C9933A; flex-shrink: 0; }
    .icon-preview-img { width: 1.6rem; height: 1.6rem; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
    .icon-search-field { flex: 1; min-width: 160px; }
    .option-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; vertical-align: middle; margin-right: 6px; color: #666; }
    .option-img { width: 1.1rem; height: 1.1rem; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 6px; }
    .option-usage { color: #999; font-size: 0.8em; margin-left: 4px; }
    .usage-hint { margin: 4px 0 0; font-size: 0.78rem; color: #888; }
    .icon-upload-form {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      padding: 10px;
      background: #faf7f2;
      border-radius: 8px;
    }
    .upload-name-field { width: 200px; }
    .upload-preview { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
    .icon-manage-panel {
      margin-top: 6px;
      padding: 10px;
      background: #faf7f2;
      border-radius: 8px;
    }
    .manage-panel-title { font-size: 0.8rem; font-weight: 700; color: #666; margin-bottom: 6px; }
    .manage-empty { color: #999; font-size: 0.85rem; margin: 0; }
    .manage-list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
    .manage-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
    .manage-thumb { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
    .manage-name { flex: 1; font-size: 0.85rem; }
    .manage-usage { font-size: 0.75rem; color: #999; }
  `],
})
export class IconPickerComponent implements OnChanges, OnInit {
  private readonly communityService = inject(CommunityService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  @Input() icon = '';
  @Input() label = 'Icon';
  @Output() iconChange = new EventEmitter<string>();

  query = '';
  uploadName = '';
  uploadBlob: Blob | null = null;
  uploadPreviewUrl: string | null = null;

  readonly filtered = signal<string[]>(ICON_NAMES.slice(0, 40));
  readonly customIcons = signal<CustomIcon[]>([]);
  readonly filteredCustomIcons = signal<CustomIcon[]>([]);
  readonly showUploadForm = signal(false);
  readonly showManagePanel = signal(false);
  readonly uploading = signal(false);
  readonly currentUsage = signal<number | null>(null);
  readonly reprocessingId = signal<number | null>(null);
  private readonly cacheBust = new Map<number, number>();

  ngOnInit(): void {
    this.communityService.listCustomIcons().subscribe({
      next: (list) => {
        this.customIcons.set(list);
        this.filteredCustomIcons.set(list);
        this.syncQueryFromIcon();
      },
      error: () => {},
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['icon']) {
      this.syncQueryFromIcon();
    }
  }

  private syncQueryFromIcon(): void {
    if (this.isImg(this.icon)) {
      const match = this.customIcons().find((c) => this.valueFor(c) === this.icon);
      this.query = match ? match.name : this.icon;
      this.currentUsage.set(match ? match.usageCount : null);
    } else {
      this.query = this.icon;
      this.currentUsage.set(null);
    }
  }

  isImg(value: string): boolean {
    return value.startsWith(IMG_PREFIX);
  }

  srcFor(value: string): string {
    return value.slice(IMG_PREFIX.length);
  }

  valueFor(item: CustomIcon): string {
    return IMG_PREFIX + item.imagePath;
  }

  onQueryChange(value: string): void {
    this.query = value;
    this.iconChange.emit(value);
    this.currentUsage.set(null);
    const q = value.trim().toLowerCase();
    this.filtered.set(
      q ? ICON_NAMES.filter((n) => n.includes(q)).slice(0, 40) : ICON_NAMES.slice(0, 40),
    );
    this.filteredCustomIcons.set(
      q ? this.customIcons().filter((c) => c.name.toLowerCase().includes(q)) : this.customIcons(),
    );
  }

  onSelect(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value as string;
    if (this.isImg(value)) {
      const match = this.customIcons().find((c) => this.valueFor(c) === value);
      this.query = match ? match.name : value;
      this.currentUsage.set(match ? match.usageCount : null);
    } else {
      this.query = value;
      this.currentUsage.set(null);
    }
    this.iconChange.emit(value);
  }

  onUploadFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = '';
    if (!file) return;
    const ref = this.dialog.open(PhotoCropDialogComponent, {
      data: { file, shape: 'circle', format: 'png' },
      disableClose: true,
      maxWidth: '95vw',
    });
    ref.afterClosed().subscribe(async (blob: Blob | null) => {
      if (!blob) return;
      const cleaned = await removeWhiteBackground(blob);
      this.uploadBlob = cleaned;
      if (this.uploadPreviewUrl) URL.revokeObjectURL(this.uploadPreviewUrl);
      this.uploadPreviewUrl = URL.createObjectURL(cleaned);
    });
  }

  doUpload(): void {
    if (!this.uploadBlob || !this.uploadName.trim()) return;
    this.uploading.set(true);
    this.communityService.createCustomIcon(this.uploadName.trim(), this.uploadBlob).subscribe({
      next: (created) => {
        const updated = [...this.customIcons(), created].sort((a, b) => a.name.localeCompare(b.name));
        this.customIcons.set(updated);
        this.filteredCustomIcons.set(updated);
        this.query = created.name;
        this.currentUsage.set(created.usageCount);
        this.iconChange.emit(this.valueFor(created));
        this.uploading.set(false);
        this.showUploadForm.set(false);
        this.resetUploadState();
      },
      error: () => {
        this.uploading.set(false);
        this.snackBar.open('Failed to upload icon', 'OK', { duration: 3000 });
      },
    });
  }

  cancelUpload(): void {
    this.showUploadForm.set(false);
    this.resetUploadState();
  }

  deleteCustomIcon(item: CustomIcon): void {
    if (item.usageCount > 0) return;
    if (!window.confirm(`Delete "${item.name}" from the icon library? This can't be undone.`)) return;
    this.communityService.deleteCustomIcon(item.id).subscribe({
      next: () => {
        const updated = this.customIcons().filter((c) => c.id !== item.id);
        this.customIcons.set(updated);
        this.filteredCustomIcons.set(
          this.query.trim()
            ? updated.filter((c) => c.name.toLowerCase().includes(this.query.trim().toLowerCase()))
            : updated,
        );
        this.snackBar.open('Icon deleted', 'OK', { duration: 2000 });
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Failed to delete icon';
        this.snackBar.open(msg, 'OK', { duration: 4000 });
      },
    });
  }

  thumbSrc(item: CustomIcon): string {
    const v = this.cacheBust.get(item.id);
    return v ? `${item.imagePath}?v=${v}` : item.imagePath;
  }

  reprocessIcon(item: CustomIcon): void {
    this.reprocessingId.set(item.id);
    fetch(item.imagePath)
      .then((res) => res.blob())
      .then((original) => removeWhiteBackground(original))
      .then((cleaned) => {
        this.communityService.reprocessCustomIcon(item.id, cleaned).subscribe({
          next: () => {
            this.cacheBust.set(item.id, Date.now());
            this.reprocessingId.set(null);
            this.snackBar.open(`"${item.name}" cleaned up`, 'OK', { duration: 2000 });
          },
          error: () => {
            this.reprocessingId.set(null);
            this.snackBar.open('Failed to clean up icon', 'OK', { duration: 3000 });
          },
        });
      })
      .catch(() => {
        this.reprocessingId.set(null);
        this.snackBar.open('Failed to fetch icon for cleanup', 'OK', { duration: 3000 });
      });
  }

  private resetUploadState(): void {
    this.uploadName = '';
    this.uploadBlob = null;
    if (this.uploadPreviewUrl) URL.revokeObjectURL(this.uploadPreviewUrl);
    this.uploadPreviewUrl = null;
  }
}
