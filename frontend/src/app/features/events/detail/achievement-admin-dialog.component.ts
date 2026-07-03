import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommunityService, EventAchievement } from '../../../core/services/community.service';
import { IconPickerComponent } from '../../../shared/components/icon-picker/icon-picker.component';

export interface AchievementAdminDialogData {
  eventId: number;
  achievement: EventAchievement | null;
  /** Called whenever the achievement is created/updated/re-imaged, so the page's public badge can update live. */
  onChange: (achievement: EventAchievement) => void;
}

@Component({
  selector: 'app-achievement-admin-dialog',
  standalone: true,
  imports: [
    IconPickerComponent,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title><mat-icon>local_activity</mat-icon> Special Dinner Achievement</h2>
    <mat-dialog-content>
      @if (achievement()) {
        @if (editMode()) {
          <div class="ach-form">
            <mat-form-field appearance="outline" class="ach-field">
              <mat-label>Achievement Name</mat-label>
              <input matInput [value]="formName()" (input)="formName.set($any($event.target).value)" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="ach-field">
              <mat-label>Description</mat-label>
              <input matInput [value]="formDesc()" (input)="formDesc.set($any($event.target).value)" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="ach-field ach-field-sm">
              <mat-label>Title (optional)</mat-label>
              <input matInput [value]="formTitle()" (input)="formTitle.set($any($event.target).value)" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="ach-field ach-field-xs">
              <mat-label>Points</mat-label>
              <input matInput type="number" min="0" max="99"
                [value]="formPoints()"
                (input)="formPoints.set(+$any($event.target).value)" />
            </mat-form-field>
            <app-icon-picker [icon]="formIcon()" (iconChange)="formIcon.set($event)" />
            <label class="ach-secret-toggle">
              <input type="checkbox" [checked]="formSecret()" (change)="formSecret.set($any($event.target).checked)" />
              Hidden achievement (secret — not visible until earned)
            </label>
            <div class="ach-form-actions">
              <button mat-raised-button color="primary"
                [disabled]="saving() || !formName() || !formDesc()"
                (click)="save()">
                <mat-icon>save</mat-icon>
                {{ saving() ? 'Saving…' : 'Save Changes' }}
              </button>
              <button mat-button (click)="editMode.set(false)">Cancel</button>
            </div>
          </div>
        } @else {
          <div class="ach-exists">
            @if (achievement()!.imagePath) {
              <img [src]="achievement()!.imagePath!" class="ach-admin-img" alt="Achievement" />
            }
            <div class="ach-exists-info">
              <div class="ach-exists-name">{{ achievement()!.name }}</div>
              <div class="ach-exists-desc">{{ achievement()!.description }}</div>
              @if (achievement()!.title) {
                <div class="ach-exists-title">Title: "{{ achievement()!.title }}"</div>
              }
              <div class="ach-exists-pts">+{{ achievement()!.points }} pts</div>
            </div>
            <div class="ach-exists-actions">
              <button mat-icon-button (click)="startEdit()" matTooltip="Edit achievement">
                <mat-icon>edit</mat-icon>
              </button>
              <label class="ach-upload-btn" [class.uploading]="imageUploading()">
                <mat-icon>photo_camera</mat-icon>
                {{ imageUploading() ? 'Uploading…' : 'Change Image' }}
                <input type="file" accept="image/*" style="display:none"
                  (change)="uploadImage($event)" [disabled]="imageUploading()" />
              </label>
            </div>
          </div>
        }
      } @else if (showCreateForm()) {
        <div class="ach-form">
          <mat-form-field appearance="outline" class="ach-field">
            <mat-label>Achievement Name</mat-label>
            <input matInput [value]="formName()" (input)="formName.set($any($event.target).value)" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="ach-field">
            <mat-label>Description (requirement to display)</mat-label>
            <input matInput [value]="formDesc()" (input)="formDesc.set($any($event.target).value)" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="ach-field ach-field-sm">
            <mat-label>Title (optional)</mat-label>
            <input matInput [value]="formTitle()" (input)="formTitle.set($any($event.target).value)"
              placeholder="e.g. Founding Bear" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="ach-field ach-field-xs">
            <mat-label>Points</mat-label>
            <input matInput type="number" min="0" max="99"
              [value]="formPoints()"
              (input)="formPoints.set(+$any($event.target).value)" />
          </mat-form-field>
          <app-icon-picker [icon]="formIcon()" (iconChange)="formIcon.set($event)" />
          <div class="ach-form-actions">
            <button mat-raised-button color="primary"
              [disabled]="creating() || !formName() || !formDesc()"
              (click)="create()">
              <mat-icon>add</mat-icon>
              {{ creating() ? 'Creating…' : 'Create Achievement' }}
            </button>
            <button mat-button (click)="showCreateForm.set(false)">Cancel</button>
          </div>
        </div>
      } @else {
        <p class="ach-empty">No special achievement for this event.</p>
        <button mat-stroked-button (click)="showCreateForm.set(true)">
          <mat-icon>add</mat-icon> Add Achievement
        </button>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 320px; }
    .ach-exists { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .ach-admin-img { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
    .ach-exists-info { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .ach-exists-name { font-weight: 700; font-size: 1rem; }
    .ach-exists-desc { font-size: 0.85rem; color: #555; }
    .ach-exists-title { font-size: 0.8rem; color: #C9933A; font-weight: 600; font-style: italic; }
    .ach-exists-pts { font-size: 0.8rem; color: #1E4D8C; font-weight: 700; }
    .ach-upload-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.8rem;
      color: var(--db-primary);
      cursor: pointer;
      &.uploading { opacity: 0.6; pointer-events: none; }
    }
    .ach-exists-actions { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
    .ach-form { display: flex; flex-direction: column; gap: 8px; }
    .ach-field { width: 100%; }
    .ach-field-sm { max-width: 260px; }
    .ach-field-xs { max-width: 120px; }
    .ach-form-actions { display: flex; align-items: center; gap: 12px; }
    .ach-secret-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: #555;
    }
    .ach-empty { color: #999; font-size: 0.9rem; margin: 0 0 12px; }
  `],
})
export class AchievementAdminDialogComponent {
  private readonly communityService = inject(CommunityService);
  private readonly snackBar = inject(MatSnackBar);
  readonly data = inject<AchievementAdminDialogData>(MAT_DIALOG_DATA);

  readonly achievement = signal<EventAchievement | null>(this.data.achievement);
  readonly formName = signal('');
  readonly formDesc = signal('');
  readonly formTitle = signal('');
  readonly formPoints = signal(1);
  readonly formIcon = signal('local_activity');
  readonly formSecret = signal(false);
  readonly creating = signal(false);
  readonly saving = signal(false);
  readonly imageUploading = signal(false);
  readonly showCreateForm = signal(false);
  readonly editMode = signal(false);

  create(): void {
    this.creating.set(true);
    this.communityService.adminCreateEventAchievement(this.data.eventId, {
      name: this.formName(),
      description: this.formDesc(),
      title: this.formTitle() || undefined,
      points: this.formPoints(),
      icon: this.formIcon(),
    }).subscribe({
      next: (ach) => {
        this.achievement.set(ach);
        this.data.onChange(ach);
        this.showCreateForm.set(false);
        this.creating.set(false);
        this.snackBar.open('Achievement created!', 'OK', { duration: 3000 });
      },
      error: () => {
        this.creating.set(false);
        this.snackBar.open('Failed to create achievement', 'OK', { duration: 3000 });
      },
    });
  }

  startEdit(): void {
    const a = this.achievement();
    if (!a) return;
    this.formName.set(a.name);
    this.formDesc.set(a.description);
    this.formTitle.set(a.title ?? '');
    this.formPoints.set(a.points);
    this.formIcon.set(a.icon);
    this.formSecret.set(a.isSecret);
    this.editMode.set(true);
  }

  save(): void {
    const a = this.achievement();
    if (!a) return;
    this.saving.set(true);
    this.communityService.adminUpdateAchievement(a.id, {
      name: this.formName(),
      description: this.formDesc(),
      icon: this.formIcon(),
      title: this.formTitle() || null,
      points: this.formPoints(),
      isSecret: this.formSecret(),
    }).subscribe({
      next: () => {
        const updated: EventAchievement = {
          ...a,
          name: this.formName(),
          description: this.formDesc(),
          title: this.formTitle() || null,
          points: this.formPoints(),
          icon: this.formIcon(),
          isSecret: this.formSecret(),
        };
        this.achievement.set(updated);
        this.data.onChange(updated);
        this.editMode.set(false);
        this.saving.set(false);
        this.snackBar.open('Achievement updated', 'OK', { duration: 2000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to update achievement', 'OK', { duration: 3000 });
      },
    });
  }

  uploadImage(ev: globalThis.Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    const current = this.achievement();
    if (!file || !current) return;
    this.imageUploading.set(true);
    this.communityService.adminUploadAchievementImage(current.id, file).subscribe({
      next: ({ imagePath }) => {
        this.achievement.update((a) => a ? { ...a, imagePath } : a);
        this.data.onChange(this.achievement()!);
        this.imageUploading.set(false);
        this.snackBar.open('Image uploaded!', 'OK', { duration: 2000 });
      },
      error: () => {
        this.imageUploading.set(false);
        this.snackBar.open('Image upload failed', 'OK', { duration: 3000 });
      },
    });
  }
}
