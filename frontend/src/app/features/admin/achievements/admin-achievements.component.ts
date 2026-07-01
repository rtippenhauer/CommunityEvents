import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommunityService, AdminAchievement } from '../../../core/services/community.service';

const CATEGORY_META: Record<string, { label: string; icon: string; isProgressive: boolean }> = {
  attendance:                 { label: 'Attendance',             icon: 'local_dining',     isProgressive: true },
  coordinator:                { label: 'Coordinator',            icon: 'event_available',  isProgressive: true },
  new_restaurant_coordinator: { label: 'Scout',                  icon: 'travel_explore',   isProgressive: true },
  invite:                     { label: 'Invites',                icon: 'person_add',       isProgressive: true },
  rating:                     { label: 'Ratings',                icon: 'star',             isProgressive: true },
  founding:                   { label: 'Founding Bear',          icon: 'history_edu',      isProgressive: false },
  event:                      { label: 'Special Dinners',        icon: 'celebration',      isProgressive: false },
};

const CATEGORY_ORDER = ['attendance','coordinator','new_restaurant_coordinator','invite','rating','founding','event'];

interface AchGroup {
  type: string;
  label: string;
  icon: string;
  isProgressive: boolean;
  achievements: AdminAchievement[];
}

interface EditForm {
  name: string;
  description: string;
  icon: string;
  points: number;
  title: string;
  isSecret: boolean;
  progressTarget: number | null;
}

interface AddForm extends EditForm {
  key: string;
  progressType: string;
}

@Component({
  selector: 'app-admin-achievements',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <a mat-button routerLink="/admin/users"><mat-icon>arrow_back</mat-icon> Admin</a>
        <h1 class="page-title">Achievement Management</h1>
      </div>

      @if (loading()) {
        <div class="center-spinner"><mat-spinner diameter="40" /></div>
      } @else {
        @for (group of groups(); track group.type) {
          <mat-card class="group-card">
            <mat-card-header>
              <mat-icon class="group-icon">{{ group.icon }}</mat-icon>
              <div class="group-title">
                <mat-card-title>{{ group.label }}</mat-card-title>
                <mat-card-subtitle>{{ group.achievements.length }} tier{{ group.achievements.length === 1 ? '' : 's' }}</mat-card-subtitle>
              </div>
            </mat-card-header>
            <mat-card-content>
              @if (group.achievements.length > 0) {
                <div class="ach-table-wrap">
                  <table class="ach-table">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Name</th>
                        <th class="col-num">Target</th>
                        <th class="col-num">Pts</th>
                        <th>Title</th>
                        <th class="col-icon">Secret</th>
                        <th class="col-num">Earners</th>
                        <th class="col-action"></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (a of group.achievements; track a.id) {
                        <tr class="ach-row" [class.is-editing]="editingId() === a.id">
                          <td class="key-cell">{{ a.key }}</td>
                          <td>
                            <mat-icon class="ach-row-icon">{{ a.icon }}</mat-icon>
                            {{ a.name }}
                          </td>
                          <td class="col-num">{{ a.progressTarget ?? '—' }}</td>
                          <td class="col-num">{{ a.points }}</td>
                          <td class="col-title">{{ a.title || '—' }}</td>
                          <td class="col-icon">
                            @if (a.isSecret) { <mat-icon class="secret-yes">lock</mat-icon> }
                            @else { <mat-icon class="secret-no">lock_open</mat-icon> }
                          </td>
                          <td class="col-num">{{ a.earnedCount }}</td>
                          <td class="col-action">
                            <button mat-icon-button matTooltip="Edit"
                              [color]="editingId() === a.id ? 'primary' : ''"
                              (click)="toggleEdit(a)">
                              <mat-icon>{{ editingId() === a.id ? 'close' : 'edit' }}</mat-icon>
                            </button>
                          </td>
                        </tr>
                        @if (editingId() === a.id) {
                          <tr class="edit-row">
                            <td colspan="8">
                              <div class="inline-form">
                                <div class="form-row">
                                  <mat-form-field appearance="outline" class="field-name">
                                    <mat-label>Name</mat-label>
                                    <input matInput [(ngModel)]="editForm.name" />
                                  </mat-form-field>
                                  <mat-form-field appearance="outline" class="field-icon">
                                    <mat-label>Icon (emoji or material icon)</mat-label>
                                    <input matInput [(ngModel)]="editForm.icon" />
                                  </mat-form-field>
                                  <mat-form-field appearance="outline" class="field-pts">
                                    <mat-label>Points</mat-label>
                                    <input matInput type="number" min="0" [(ngModel)]="editForm.points" />
                                  </mat-form-field>
                                  @if (group.isProgressive) {
                                    <mat-form-field appearance="outline" class="field-pts">
                                      <mat-label>Target</mat-label>
                                      <input matInput type="number" min="1" [(ngModel)]="editForm.progressTarget" />
                                    </mat-form-field>
                                  }
                                </div>
                                <mat-form-field appearance="outline" class="field-full">
                                  <mat-label>Description</mat-label>
                                  <textarea matInput rows="2" [(ngModel)]="editForm.description"></textarea>
                                </mat-form-field>
                                <div class="form-row form-row-bottom">
                                  <mat-form-field appearance="outline" class="field-title">
                                    <mat-label>Title (optional)</mat-label>
                                    <input matInput [(ngModel)]="editForm.title" />
                                  </mat-form-field>
                                  <mat-checkbox [(ngModel)]="editForm.isSecret" class="secret-check">
                                    Hidden (secret)
                                  </mat-checkbox>
                                  <div class="edit-actions">
                                    <button mat-raised-button color="primary" [disabled]="saving()" (click)="saveEdit(a)">
                                      @if (saving()) { <mat-spinner diameter="16" /> } Save
                                    </button>
                                    <button mat-button (click)="cancelEdit()">Cancel</button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                </div>
              }

              @if (group.isProgressive) {
                @if (addingToType() === group.type) {
                  <div class="add-tier-form">
                    <div class="add-tier-title">New {{ group.label }} Tier</div>
                    <div class="form-row">
                      <mat-form-field appearance="outline" class="field-key">
                        <mat-label>Key (unique)</mat-label>
                        <input matInput [(ngModel)]="addForm.key"
                          [placeholder]="suggestKey(group.type)" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="field-name">
                        <mat-label>Name</mat-label>
                        <input matInput [(ngModel)]="addForm.name" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="field-icon">
                        <mat-label>Icon</mat-label>
                        <input matInput [(ngModel)]="addForm.icon" placeholder="emoji_events" />
                      </mat-form-field>
                    </div>
                    <mat-form-field appearance="outline" class="field-full">
                      <mat-label>Description</mat-label>
                      <textarea matInput rows="2" [(ngModel)]="addForm.description"></textarea>
                    </mat-form-field>
                    <div class="form-row form-row-bottom">
                      <mat-form-field appearance="outline" class="field-pts">
                        <mat-label>Target</mat-label>
                        <input matInput type="number" min="1" [(ngModel)]="addForm.progressTarget" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="field-pts">
                        <mat-label>Points</mat-label>
                        <input matInput type="number" min="0" [(ngModel)]="addForm.points" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" class="field-title">
                        <mat-label>Title (optional)</mat-label>
                        <input matInput [(ngModel)]="addForm.title" />
                      </mat-form-field>
                      <mat-checkbox [(ngModel)]="addForm.isSecret" class="secret-check">Hidden</mat-checkbox>
                      <div class="edit-actions">
                        <button mat-raised-button color="primary" [disabled]="saving()"
                          (click)="saveAdd(group.type)">
                          @if (saving()) { <mat-spinner diameter="16" /> } Add Tier
                        </button>
                        <button mat-button (click)="cancelAdd()">Cancel</button>
                      </div>
                    </div>
                  </div>
                } @else {
                  <button mat-stroked-button class="add-tier-btn"
                    (click)="startAdd(group.type, group.achievements)">
                    <mat-icon>add</mat-icon> Add {{ group.label }} Tier
                  </button>
                }
              }
            </mat-card-content>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1000px; margin: 0 auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 24px; }
    .page-header { display: flex; align-items: center; gap: 12px; }
    .page-title { font-size: 1.4rem; font-weight: 700; margin: 0; }
    .center-spinner { display: flex; justify-content: center; padding: 48px; }

    .group-card mat-card-header { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; }
    .group-icon { font-size: 1.4rem; width: 1.4rem; height: 1.4rem; color: #C9933A; flex-shrink: 0; }
    .group-title mat-card-title { font-size: 1rem; margin: 0; }
    .group-title mat-card-subtitle { margin: 0; }

    .ach-table-wrap { overflow-x: auto; margin-bottom: 12px; }
    .ach-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .ach-table th {
      text-align: left; padding: 8px 10px; border-bottom: 2px solid #e0e0e0;
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; color: #888; white-space: nowrap;
    }
    .ach-table td { padding: 8px 10px; border-bottom: 1px solid #f5f5f5; vertical-align: middle; }
    .ach-row:hover td { background: #fafafa; }
    .ach-row.is-editing td { background: #f0f7ff; }
    .col-num { text-align: center; width: 60px; }
    .col-icon { text-align: center; width: 60px; }
    .col-action { width: 44px; }
    .col-title { color: #888; font-style: italic; }
    .key-cell { font-family: monospace; font-size: 0.78rem; color: #666; }
    .ach-row-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; vertical-align: middle; color: #C9933A; margin-right: 4px; }
    .secret-yes { color: #f57c00; font-size: 1rem; width: 1rem; height: 1rem; }
    .secret-no { color: #ccc; font-size: 1rem; width: 1rem; height: 1rem; }

    .edit-row td { padding: 0; background: #f8fbff !important; border-bottom: 2px solid #1E4D8C22; }
    .inline-form { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .add-tier-form { padding: 16px; background: #f8f9fa; border-radius: 8px; border: 1px dashed #ccc; display: flex; flex-direction: column; gap: 8px; }
    .add-tier-title { font-size: 0.85rem; font-weight: 600; color: #1E4D8C; margin-bottom: 4px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
    .form-row-bottom { align-items: center; }
    .field-full { width: 100%; }
    .field-name { flex: 2; min-width: 180px; }
    .field-key { flex: 1.5; min-width: 150px; }
    .field-icon { flex: 1; min-width: 120px; }
    .field-pts { width: 90px; flex-shrink: 0; }
    .field-title { flex: 1.5; min-width: 150px; }
    .secret-check { margin-top: 8px; }
    .edit-actions { display: flex; gap: 8px; align-items: center; margin-left: auto; }
    .add-tier-btn { margin-top: 4px; }
  `],
})
export class AdminAchievementsComponent implements OnInit {
  private readonly communityService = inject(CommunityService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly achievements = signal<AdminAchievement[]>([]);
  readonly editingId = signal<number | null>(null);
  readonly addingToType = signal<string | null>(null);

  editForm: EditForm = this.blankEdit();
  addForm: AddForm = this.blankAdd('');

  readonly groups = computed<AchGroup[]>(() => {
    const map = new Map<string, AdminAchievement[]>();
    for (const a of this.achievements()) {
      const type = a.progressType ?? 'event';
      if (!map.has(type)) map.set(type, []);
      map.get(type)!.push(a);
    }
    return CATEGORY_ORDER
      .filter((t) => map.has(t))
      .map((t) => ({
        type: t,
        label: CATEGORY_META[t]?.label ?? t,
        icon: CATEGORY_META[t]?.icon ?? 'emoji_events',
        isProgressive: CATEGORY_META[t]?.isProgressive ?? false,
        achievements: map.get(t)!,
      }));
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.communityService.adminListAchievements().subscribe({
      next: (list) => { this.achievements.set(list); this.loading.set(false); },
      error: () => { this.snackBar.open('Failed to load achievements', 'OK', { duration: 3000 }); this.loading.set(false); },
    });
  }

  toggleEdit(a: AdminAchievement): void {
    if (this.editingId() === a.id) {
      this.cancelEdit();
    } else {
      this.addingToType.set(null);
      this.editingId.set(a.id);
      this.editForm = {
        name: a.name,
        description: a.description,
        icon: a.icon,
        points: a.points,
        title: a.title ?? '',
        isSecret: a.isSecret,
        progressTarget: a.progressTarget,
      };
    }
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editForm = this.blankEdit();
  }

  saveEdit(a: AdminAchievement): void {
    this.saving.set(true);
    this.communityService.adminUpdateAchievement(a.id, {
      name: this.editForm.name,
      description: this.editForm.description,
      icon: this.editForm.icon || 'emoji_events',
      points: this.editForm.points,
      title: this.editForm.title || null,
      isSecret: this.editForm.isSecret,
      progressTarget: this.editForm.progressTarget,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelEdit();
        this.load();
        this.snackBar.open('Achievement updated', 'OK', { duration: 2000 });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to save', 'OK', { duration: 3000 });
      },
    });
  }

  startAdd(type: string, existing: AdminAchievement[]): void {
    this.cancelEdit();
    this.addingToType.set(type);
    const nextTarget = existing.length > 0
      ? Math.max(...existing.map((a) => a.progressTarget ?? 0)) + 5
      : 1;
    this.addForm = {
      ...this.blankAdd(type),
      progressType: type,
      progressTarget: nextTarget,
      points: 1,
    };
  }

  cancelAdd(): void {
    this.addingToType.set(null);
    this.addForm = this.blankAdd('');
  }

  saveAdd(type: string): void {
    const key = this.addForm.key.trim();
    const name = this.addForm.name.trim();
    const desc = this.addForm.description.trim();
    if (!key || !name || !desc) {
      this.snackBar.open('Key, name, and description are required', 'OK', { duration: 3000 });
      return;
    }
    this.saving.set(true);
    this.communityService.adminCreateAchievement({
      key,
      name,
      description: desc,
      icon: this.addForm.icon || 'emoji_events',
      progressType: type,
      progressTarget: this.addForm.progressTarget,
      points: this.addForm.points,
      title: this.addForm.title || null,
      isSecret: this.addForm.isSecret,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelAdd();
        this.load();
        this.snackBar.open('Tier added!', 'OK', { duration: 2000 });
      },
      error: (err) => {
        this.saving.set(false);
        const msg = err?.error?.message ?? 'Failed to create tier';
        this.snackBar.open(msg, 'OK', { duration: 4000 });
      },
    });
  }

  suggestKey(type: string): string {
    const existing = this.groups().find((g) => g.type === type)?.achievements ?? [];
    const nextTarget = existing.length > 0
      ? Math.max(...existing.map((a) => a.progressTarget ?? 0)) + 5
      : 1;
    const prefix = type === 'new_restaurant_coordinator' ? 'scout' : type;
    return `${prefix}_${nextTarget}`;
  }

  private blankEdit(): EditForm {
    return { name: '', description: '', icon: 'emoji_events', points: 1, title: '', isSecret: false, progressTarget: null };
  }

  private blankAdd(type: string): AddForm {
    return { key: '', name: '', description: '', icon: 'emoji_events', points: 1, title: '', isSecret: false, progressTarget: null, progressType: type };
  }
}
