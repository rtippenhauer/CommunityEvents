import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { AppConfigService } from '../../../core/services/app-config.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import {
  PALETTE_TOKENS,
  contrastWarnings,
  derivePalette,
  parseOverrides,
  resolvePalette,
  suggestFix,
  type ContrastWarning,
  type PaletteFix,
  type PaletteOverrides,
  type PaletteSeeds,
  type PaletteToken,
} from '../../../core/utils/palette';
import { PALETTE_PRESETS, presetForSeeds } from '../../../core/utils/palette-presets';
import { HEX_COLOR_PATTERN, PALETTE_PROMPT, parsePastedPalette } from './palette-prompt';

/** A token grouped for display, so the override list is scannable. */
interface TokenGroup {
  label: string;
  hint: string;
  tokens: readonly PaletteToken[];
}

const TOKEN_GROUPS: readonly TokenGroup[] = [
  {
    label: 'Primary',
    hint: 'Buttons, links and highlights.',
    tokens: ['--ce-primary', '--ce-on-primary', '--ce-primary-hover'],
  },
  {
    label: 'Accent',
    hint: 'Your second colour, and anything painted with both.',
    tokens: ['--ce-accent', '--ce-on-accent', '--ce-accent-on-chrome', '--ce-on-brand-blend'],
  },
  {
    label: 'Page',
    hint: 'The ground everything sits on, and the text on it.',
    tokens: ['--ce-surface', '--ce-surface-variant', '--ce-text', '--ce-text-muted'],
  },
  {
    label: 'Nav and footer',
    hint: 'The dark chrome around the page.',
    tokens: [
      '--ce-chrome',
      '--ce-chrome-deep',
      '--ce-chrome-raised',
      '--ce-chrome-soft',
      '--ce-on-chrome',
      '--ce-on-chrome-muted',
    ],
  },
  {
    label: 'Environment banner',
    hint: 'Only visible on a stage deployment.',
    tokens: ['--ce-banner', '--ce-on-banner'],
  },
];

@Component({
  selector: 'app-admin-appearance',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  templateUrl: './admin-appearance.component.html',
  styleUrl: './admin-appearance.component.scss',
})
export class AdminAppearanceComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly appConfig = inject(AppConfigService);
  private readonly brand = inject(BrandConfigService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly presets = PALETTE_PRESETS;
  readonly tokenGroups = TOKEN_GROUPS;
  readonly allTokens = PALETTE_TOKENS;
  readonly prompt = PALETTE_PROMPT;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly pasteError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    primary: ['#C9933A', [Validators.required, Validators.pattern(HEX_COLOR_PATTERN)]],
    accent: ['#C9933A', [Validators.required, Validators.pattern(HEX_COLOR_PATTERN)]],
    background: ['#FDFAF5', [Validators.required, Validators.pattern(HEX_COLOR_PATTERN)]],
  });

  /** Live seed values, as a signal, so the preview recomputes on every keystroke. */
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** Per-token overrides. Held apart from the form: they are sparse by nature. */
  readonly overrides = signal<PaletteOverrides>({});

  readonly seeds = computed<PaletteSeeds>(() => {
    // Read through the signal so this recomputes, but take the authoritative
    // values from the control — valueChanges emits partials.
    this.formValue();
    const v = this.form.getRawValue();
    return { primary: v.primary, accent: v.accent, background: v.background };
  });

  /** What the page would look like if saved. One derivation, shared with the app. */
  readonly palette = computed(() => resolvePalette(this.seeds(), this.overrides()));

  /** The same palette with no overrides — what "reset this token" would give. */
  readonly derived = computed(() => derivePalette(this.seeds()));

  readonly warnings = computed(() => contrastWarnings(this.palette()));

  readonly activePreset = computed(() => presetForSeeds(this.seeds()));

  readonly overrideCount = computed(() => Object.keys(this.overrides()).length);

  /**
   * Inline `style` for the preview container.
   *
   * Scoped to this element rather than `:root` deliberately — the preview must
   * not touch the running page. An admin trying a palette should be able to
   * decide against it and navigate away without having repainted the app they
   * are still using.
   */
  readonly previewStyle = computed(() => {
    const palette = this.palette();
    return PALETTE_TOKENS.map((t) => `${t}:${palette[t]}`).join(';');
  });

  ngOnInit(): void {
    this.appConfig.getSiteSettings().subscribe({
      next: (settings) => {
        const byKey = new Map(settings.map((s) => [s.configKey, s.configValue]));
        this.form.patchValue({
          primary: byKey.get('theme_color_primary') || '#C9933A',
          accent: byKey.get('theme_color_accent') || '#C9933A',
          background: byKey.get('theme_color_background') || '#FDFAF5',
        });
        this.overrides.set(parseOverrides(byKey.get('theme_palette_overrides')));
        this.loading.set(false);
      },
      error: () => {
        this.snackBar.open('Could not load the current colours', 'OK', { duration: 4000 });
        this.loading.set(false);
      },
    });
  }

  applyPreset(key: string): void {
    const preset = this.presets.find((p) => p.key === key);
    if (!preset) return;

    // Picking a preset is a statement about the whole palette, so it does clear
    // per-token overrides -- leaving them layered on means the preset does not
    // look like the swatches that sold it. But discarding an admin's hand-tuned
    // colours is destructive, and a snackbar *after* the fact is not consent:
    // Rob hit exactly this on stage, having been told overrides survive a
    // colour change (they do -- a seed edit keeps them; only a preset, which
    // replaces all three at once, does not). So ask first.
    const count = this.overrideCount();
    if (!count) {
      this.setPresetSeeds(preset);
      return;
    }

    const data: ConfirmDialogData = {
      title: `Apply ${preset.label}?`,
      message:
        `You have ${count} colour${count === 1 ? '' : 's'} fine-tuned by hand. ` +
        `Applying a preset replaces the whole palette, so ${count === 1 ? 'it' : 'they'} ` +
        `will go back to being worked out automatically.`,
      confirmLabel: `Apply ${preset.label}`,
      confirmColor: 'warn',
    };
    this.dialog
      .open(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe((confirmed: boolean) => {
        if (!confirmed) return;
        this.overrides.set({});
        this.setPresetSeeds(preset);
      });
  }

  private setPresetSeeds(preset: { label: string; seeds: PaletteSeeds }): void {
    this.form.patchValue(preset.seeds);
    this.form.markAsDirty();
  }

  onSwatch(control: 'primary' | 'accent' | 'background', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.controls[control].setValue(value);
    this.form.controls[control].markAsDirty();
  }

  /** A `<input type="color">` only accepts #rrggbb, so anything else shows as black. */
  swatchValue(value: string): string {
    return HEX_COLOR_PATTERN.test(value) ? value : '#000000';
  }

  overrideValue(token: PaletteToken): string {
    return this.overrides()[token] ?? this.derived()[token];
  }

  isOverridden(token: PaletteToken): boolean {
    return this.overrides()[token] !== undefined;
  }

  setOverride(token: PaletteToken, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.overrides.update((o) => ({ ...o, [token]: value }));
  }

  clearOverride(token: PaletteToken): void {
    this.overrides.update((o) => {
      const next = { ...o };
      delete next[token];
      return next;
    });
  }

  clearAllOverrides(): void {
    this.overrides.set({});
  }

  warningFor(token: PaletteToken): string | null {
    return this.warnings().find((w) => w.token === token)?.message ?? null;
  }

  fixFor(warning: ContrastWarning): PaletteFix | null {
    return suggestFix(this.seeds(), this.overrides(), warning);
  }

  /**
   * Apply a suggested fix.
   *
   * Deliberately does not save. The admin sees the preview update and decides,
   * exactly as with every other control on this screen -- a "fix" that wrote
   * to the database on one click would be the only thing here that changes the
   * live site without being asked to.
   */
  applyFix(fix: PaletteFix): void {
    if (fix.clearOverride) {
      this.clearOverride(fix.clearOverride);
    }
    if (fix.seeds) {
      this.form.patchValue(fix.seeds);
    }
    this.form.markAsDirty();
    this.snackBar.open('Adjusted — check the preview, then save', 'OK', { duration: 4000 });
  }

  async copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.prompt);
      this.snackBar.open('Prompt copied', 'OK', { duration: 2500 });
    } catch {
      // Clipboard access is refused in plenty of ordinary situations (an
      // insecure origin, a permissions policy). The prompt is on screen and
      // selectable, so say that rather than failing silently.
      this.snackBar.open('Could not copy — select the text and copy it manually', 'OK', {
        duration: 5000,
      });
    }
  }

  /**
   * Take a palette pasted back from an LLM.
   *
   * Validated here rather than trusted: a model will occasionally return a
   * palette that fails its own brief, and the person who finds out should be
   * the admin looking at a preview, not a member looking at a button.
   */
  importPasted(raw: string): void {
    const result = parsePastedPalette(raw);
    if (!result.ok) {
      this.pasteError.set(result.error);
      return;
    }
    this.pasteError.set(null);
    this.form.patchValue(result.seeds);
    this.form.markAsDirty();
    this.overrides.set({});
    const warnings = contrastWarnings(derivePalette(result.seeds));
    this.snackBar.open(
      warnings.length
        ? `Palette loaded, with ${warnings.length} contrast warning(s) below`
        : 'Palette loaded — preview it before saving',
      'OK',
      { duration: 5000 },
    );
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const seeds = this.seeds();
    const overrides = this.overrides();
    this.appConfig
      .updateValues([
        { key: 'theme_color_primary', value: seeds.primary },
        { key: 'theme_color_accent', value: seeds.accent },
        { key: 'theme_color_background', value: seeds.background },
        {
          key: 'theme_palette_overrides',
          // Empty string rather than "{}" for the no-overrides case, so the
          // stored value matches the seeded default and a community that never
          // touched this screen is indistinguishable from one that reset it.
          value: Object.keys(overrides).length ? JSON.stringify(overrides) : '',
        },
      ])
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.form.markAsPristine();
          // Re-fetch branding so the running app repaints immediately. This is
          // the only point at which the live page changes — everything before
          // it was a scoped preview.
          void this.brand.refresh();
          this.snackBar.open('Colours saved', 'OK', { duration: 3000 });
        },
        error: () => {
          this.saving.set(false);
          this.snackBar.open('Failed to save colours', 'OK', { duration: 4000 });
        },
      });
  }
}
