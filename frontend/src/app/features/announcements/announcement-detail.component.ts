import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AnnouncementsService, Announcement, AnnouncementComment } from '../../core/services/announcements.service';
import { AuthService } from '../../core/services/auth.service';
import { ReportButtonComponent } from '../../shared/components/report-button/report-button.component';

@Component({
  selector: 'app-announcement-detail',
  standalone: true,
  imports: [
    DatePipe, RouterLink, ReactiveFormsModule,
    MatButtonModule, MatChipsModule, MatIconModule, MatInputModule,
    MatFormFieldModule, MatProgressSpinnerModule, MatSnackBarModule,
    ReportButtonComponent,
  ],
  template: `
    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (!announcement()) {
      <p class="error">Announcement not found.</p>
    } @else {
      <div class="detail-wrap">
        <a routerLink="/announcements" class="back-link">
          <mat-icon>arrow_back</mat-icon> All Announcements
        </a>

        <div class="ann-header">
          <div class="ann-meta">
            <span class="ann-date">{{ announcement()!.publishedAt | date:'MMMM d, y' }}</span>
            @if (announcement()!.city) {
              <mat-chip class="city-chip">{{ announcement()!.city!.name }}</mat-chip>
            }
          </div>
          <h1 class="ann-title">{{ announcement()!.title }}</h1>
          <div class="ann-author">
            <mat-icon class="author-icon">person</mat-icon>
            Posted by {{ announcement()!.author.fullName }}
          </div>
        </div>

        <div class="ann-body" [innerHTML]="announcement()!.body"></div>

        <!-- Comments -->
        <div class="comments-section">
          <h2 class="comments-title">
            Comments
            @if (visibleComments.length) {
              <span class="comment-count">({{ visibleComments.length }})</span>
            }
          </h2>

          @if (isLoggedIn() && !isNonValidated()) {
            <form class="comment-form" (submit)="submitComment()">
              <mat-form-field appearance="outline" class="comment-field">
                <mat-label>Add a comment</mat-label>
                <textarea matInput [formControl]="commentCtrl" rows="2" maxlength="2000"></textarea>
              </mat-form-field>
              <button mat-raised-button color="primary" type="submit"
                [disabled]="commentCtrl.invalid || submitting()">
                @if (submitting()) { <mat-spinner diameter="18" /> } @else { Post }
              </button>
            </form>
          }

          @if (visibleComments.length === 0) {
            <p class="no-comments">{{ isNonValidated() ? 'No comments yet.' : 'No comments yet. Be the first!' }}</p>
          } @else {
            <div class="comments-list">
              @for (c of visibleComments; track c.id) {
                <div class="comment">
                  <div class="comment-meta">
                    <span class="comment-author">{{ c.user.fullName }}</span>
                    <span class="comment-time">{{ c.createdAt | date:'MMM d, h:mm a' }}</span>
                    @if (canDelete(c)) {
                      <button mat-icon-button class="del-btn" (click)="deleteComment(c.id)">
                        <mat-icon>delete_outline</mat-icon>
                      </button>
                    }
                    <app-report-button
                      contentType="announcement_comment"
                      [contentId]="c.id"
                      [authorId]="c.userId" />
                  </div>
                  <p class="comment-body">{{ c.body }}</p>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 48px; }
    .error { text-align: center; color: #b00000; padding: 48px 0; }
    .detail-wrap { max-width: 720px; }
    .back-link { display: inline-flex; align-items: center; gap: 4px; color: var(--db-primary); font-size: 0.85rem; text-decoration: none; margin-bottom: 20px; &:hover { text-decoration: underline; } }
    .ann-header { margin-bottom: 20px; }
    .ann-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .ann-date { font-size: 0.75rem; font-weight: 700; color: var(--db-primary); text-transform: uppercase; letter-spacing: 0.05em; }
    .city-chip { font-size: 0.68rem !important; height: 20px !important; }
    .ann-title { margin: 0 0 8px; font-size: 1.6rem; font-weight: 700; color: var(--db-brown-dark); line-height: 1.2; }
    .ann-author { display: flex; align-items: center; gap: 4px; font-size: 0.82rem; color: #888; }
    .author-icon { font-size: 1rem; width: 1rem; height: 1rem; }
    .ann-body { font-size: 0.95rem; line-height: 1.7; color: var(--db-brown-dark); margin-bottom: 24px; }
    .comments-section { border-top: 1px solid #e8e0d6; padding-top: 24px; }
    .comments-title { font-size: 1.1rem; font-weight: 600; color: var(--db-brown-dark); margin: 0 0 16px; }
    .comment-count { font-weight: 400; color: #888; font-size: 0.9rem; }
    .comment-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    .comment-field { width: 100%; }
    .no-comments { color: #999; font-size: 0.875rem; }
    .comments-list { display: flex; flex-direction: column; gap: 12px; }
    .comment { background: var(--db-cream); border-radius: 8px; padding: 12px 14px; }
    .comment-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .comment-author { font-weight: 600; font-size: 0.85rem; color: var(--db-brown-dark); }
    .comment-time { font-size: 0.72rem; color: #aaa; }
    .del-btn { width: 28px; height: 28px; font-size: 0.85rem; color: #bbb; margin-left: auto; }
    .comment-body { margin: 0; font-size: 0.875rem; color: #444; line-height: 1.5; }
  `],
})
export class AnnouncementDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly announcementsService = inject(AnnouncementsService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);

  readonly announcement = signal<Announcement | null>(null);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly commentCtrl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(2000)] });

  get visibleComments(): AnnouncementComment[] {
    return (this.announcement()?.comments ?? []).filter((c) => !c.deletedAt);
  }

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.announcementsService.getOne(id).subscribe({
      next: (a) => { this.announcement.set(a); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  isLoggedIn(): boolean { return this.authService.isLoggedIn(); }
  isNonValidated(): boolean { return this.authService.isNonValidated(); }

  canDelete(c: AnnouncementComment): boolean {
    const user = this.authService.currentUser();
    return !!user && (user.id === c.userId || user.role === 'admin' || user.role === 'moderator');
  }

  submitComment(): void {
    if (this.commentCtrl.invalid || this.submitting()) return;
    this.submitting.set(true);
    const ann = this.announcement()!;
    this.announcementsService.addComment(ann.id, this.commentCtrl.value).subscribe({
      next: (c) => {
        const user = this.authService.currentUser()!;
        const full: AnnouncementComment = { ...c, user: { id: user.id, fullName: user.fullName, profilePhotoPath: user.profilePhotoPath ?? null } };
        this.announcement.update((a) => a ? { ...a, comments: [...a.comments, full] } : a);
        this.commentCtrl.reset();
        this.submitting.set(false);
      },
      error: () => { this.submitting.set(false); this.snackBar.open('Failed to post comment', 'OK', { duration: 3000 }); },
    });
  }

  deleteComment(commentId: number): void {
    this.announcementsService.deleteComment(commentId).subscribe({
      next: () => {
        this.announcement.update((a) => a ? {
          ...a,
          comments: a.comments.map((c) => c.id === commentId ? { ...c, deletedAt: new Date().toISOString() } : c),
        } : a);
      },
      error: () => this.snackBar.open('Failed to delete comment', 'OK', { duration: 3000 }),
    });
  }

}
