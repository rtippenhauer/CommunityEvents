import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ImageCropperComponent, ImageCroppedEvent } from 'ngx-image-cropper';

export interface PhotoCropDialogData {
  file: File;
  /** 'circle' for profile avatars (1:1 round), 'rectangle' for restaurant photos (4:3) */
  shape?: 'circle' | 'rectangle';
}

@Component({
  selector: 'app-photo-crop-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatProgressSpinnerModule, ImageCropperComponent],
  template: `
    <h2 mat-dialog-title>Crop Photo</h2>

    <mat-dialog-content class="crop-content">
      @if (!imageLoaded) {
        <div class="loading">
          <mat-spinner diameter="40" />
        </div>
      }
      <image-cropper
        [imageFile]="data.file"
        [maintainAspectRatio]="true"
        [aspectRatio]="isCircle ? 1 : 4 / 3"
        [roundCropper]="isCircle"
        [resizeToWidth]="isCircle ? 300 : 800"
        [resizeToHeight]="isCircle ? 300 : 600"
        [canvasRotation]="0"
        [allowMoveImage]="true"
        format="jpeg"
        (imageCropped)="onCropped($event)"
        (imageLoaded)="imageLoaded = true"
        class="cropper"
        [class.hidden]="!imageLoaded"
      />
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-raised-button
        color="primary"
        (click)="save()"
        [disabled]="!croppedBlob || !imageLoaded"
      >
        Use Photo
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .crop-content {
      min-width: min(90vw, 520px);
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .loading {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cropper { max-height: 60vh; }
    .hidden { visibility: hidden; }
  `],
})
export class PhotoCropDialogComponent {
  readonly data = inject<PhotoCropDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PhotoCropDialogComponent>);

  readonly isCircle = this.data.shape !== 'rectangle';

  imageLoaded = false;
  croppedBlob: Blob | null = null;

  onCropped(event: ImageCroppedEvent): void {
    this.croppedBlob = event.blob ?? null;
  }

  save(): void {
    this.dialogRef.close(this.croppedBlob);
  }
}
