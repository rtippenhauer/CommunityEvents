import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';

interface LineageNode {
  id: number;
  fullName: string;
  role: string;
  status: string;
  joinedAt: string;
  invitedMembers: LineageNode[];
}

interface FlatRow {
  id: number;
  fullName: string;
  role: string;
  status: string;
  joinedAt: string;
  depth: number;
  childCount: number;
}

@Component({
  selector: 'app-admin-invite-lineage',
  standalone: true,
  imports: [DatePipe, RouterLink, MatProgressSpinnerModule, MatIconModule, MatChipsModule, MatButtonModule],
  template: `
    <div class="lineage-container">
      <div class="lineage-header">
        <h2>Invite Lineage Tree</h2>
        <span class="subtitle">Full chain of who invited whom</span>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36" /></div>
      } @else {
        <div class="tree-meta">
          <span>{{ rows().length }} members</span>
        </div>
        <div class="tree">
          @for (row of rows(); track row.id) {
            <div class="tree-row" [style.padding-left.px]="row.depth * 20">
              <span class="connector" [class.has-children]="row.childCount > 0">
                {{ row.depth > 0 ? '↳' : '' }}
              </span>
              <a [routerLink]="['/members', row.id]" class="member-name">{{ row.fullName }}</a>
              @if (row.role !== 'member') {
                <mat-chip [class]="'role-' + row.role">{{ row.role }}</mat-chip>
              }
              @if (row.status === 'suspended') {
                <mat-chip class="chip-banned">Banned</mat-chip>
              }
              <span class="joined-at">{{ row.joinedAt | date:'MM/dd/yy' }}</span>
              @if (row.childCount > 0) {
                <span class="child-count">→ {{ row.childCount }}</span>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .lineage-container { max-width: 860px; margin: 0 auto; padding: 16px; }
    .lineage-header { margin-bottom: 12px; h2 { margin: 0; } }
    .subtitle { color: #888; font-size: 0.85rem; }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .tree-meta { font-size: 0.82rem; color: #666; margin-bottom: 12px; }
    .tree { font-size: 0.88rem; }
    .tree-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      border-bottom: 1px solid #f5f5f5;
    }
    .connector { color: #ccc; width: 14px; flex-shrink: 0; }
    .member-name {
      color: #1E4D8C;
      text-decoration: none;
      font-weight: 500;
      &:hover { text-decoration: underline; }
    }
    .joined-at { color: #aaa; font-size: 0.78rem; margin-left: auto; }
    .child-count { color: #C9933A; font-size: 0.78rem; font-weight: 600; }
    mat-chip { font-size: 0.7rem !important; min-height: 20px !important; }
    .role-admin { --mat-chip-label-text-color: #fff; background: #1E4D8C !important; }
    .role-moderator { --mat-chip-label-text-color: #fff; background: #C9933A !important; }
    .chip-banned { background: #ffccbc !important; }
  `],
})
export class AdminInviteLineageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly rows = signal<FlatRow[]>([]);

  ngOnInit(): void {
    this.http.get<LineageNode[]>('/api/v1/admin/invites/lineage').subscribe({
      next: (data) => {
        this.rows.set(this.flatten(data, 0));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private flatten(nodes: LineageNode[], depth: number): FlatRow[] {
    const result: FlatRow[] = [];
    for (const node of nodes) {
      result.push({
        id: node.id,
        fullName: node.fullName,
        role: node.role,
        status: node.status,
        joinedAt: node.joinedAt,
        depth,
        childCount: node.invitedMembers?.length ?? 0,
      });
      if (node.invitedMembers?.length) {
        result.push(...this.flatten(node.invitedMembers, depth + 1));
      }
    }
    return result;
  }
}
