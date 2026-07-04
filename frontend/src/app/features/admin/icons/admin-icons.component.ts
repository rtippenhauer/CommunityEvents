import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommunityService, CustomIcon } from '../../../core/services/community.service';
import { PhotoCropDialogComponent } from '../../../shared/components/photo-crop-dialog/photo-crop-dialog.component';
import { removeWhiteBackground } from '../../../shared/utils/remove-white-background';

@Component({
  selector: 'app-admin-icons',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <a mat-button routerLink="/admin/users"><mat-icon>arrow_back</mat-icon> Admin</a>
        <h1 class="page-title">Custom Icon Library</h1>
      </div>

      <mat-card>
        <mat-card-content>
          <div class="upload-form">
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
            @if (uploadBlob) {
              <button mat-button type="button" (click)="resetUploadState()">Cancel</button>
            }
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card>
        <mat-card-content>
          @if (loading()) {
            <div class="loading"><mat-spinner diameter="32" /></div>
          } @else if (customIcons().length === 0) {
            <p class="empty">No custom icons uploaded yet.</p>
          } @else {
            <div class="icon-list">
              @for (item of customIcons(); track item.id) {
                <div class="icon-row">
                  <img class="icon-thumb" [src]="thumbSrc(item)" alt="" />
                  <span class="icon-name">{{ item.name }}</span>
                  <span class="icon-usage">{{ item.usageCount }} use{{ item.usageCount === 1 ? '' : 's' }}</span>
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
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .page { max-width: 800px; margin: 0 auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 24px; }
    .page-header { display: flex; align-items: center; gap: 12px; }
    .page-title { font-size: 1.4rem; font-weight: 700; margin: 0; flex: 1; }
    .upload-form { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .upload-name-field { width: 220px; }
    .upload-preview { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
    .loading { display: flex; justify-content: center; padding: 32px; }
    .empty { color: #999; margin: 0; padding: 8px 0; }
    .icon-list { display: flex; flex-direction: column; gap: 4px; }
    .icon-row {
      display: flex; align-items: center; gap: 12px; padding: 8px 0;
      border-bottom: 1px solid #f0ebe4;
      &:last-child { border-bottom: none; }
    }
    .icon-thumb { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
    .icon-name { flex: 1; font-size: 0.95rem; font-weight: 500; }
    .icon-usage { font-size: 0.8rem; color: #999; }
  `],
})
export class AdminIconsComponent implements OnInit {
  private readonly communityService = inject(CommunityService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
  readonly customIcons = signal<CustomIcon[]>([]);
  readonly uploading = signal(false);
  readonly reprocessingId = signal<number | null>(null);
  private readonly cacheBust = new Map<number, number>();

  uploadName = '';
  uploadBlob: Blob | null = null;
  uploadPreviewUrl: string | null = null;

  ngOnInit(): void {
    this.communityService.listCustomIcons().subscribe({
      next: (list) => {
        this.customIcons.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
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
        this.customIcons.set([...this.customIcons(), created].sort((a, b) => a.name.localeCompare(b.name)));
        this.uploading.set(false);
        this.resetUploadState();
        this.snackBar.open(`"${created.name}" added to the library`, 'OK', { duration: 2000 });
      },
      error: () => {
        this.uploading.set(false);
        this.snackBar.open('Failed to upload icon', 'OK', { duration: 3000 });
      },
    });
  }

  resetUploadState(): void {
    this.uploadName = '';
    this.uploadBlob = null;
    if (this.uploadPreviewUrl) URL.revokeObjectURL(this.uploadPreviewUrl);
    this.uploadPreviewUrl = null;
  }

  deleteCustomIcon(item: CustomIcon): void {
    if (item.usageCount > 0) return;
    if (!window.confirm(`Delete "${item.name}" from the icon library? This can't be undone.`)) return;
    this.communityService.deleteCustomIcon(item.id).subscribe({
      next: () => {
        this.customIcons.set(this.customIcons().filter((c) => c.id !== item.id));
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
}
