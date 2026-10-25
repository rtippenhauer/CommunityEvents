import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { cities as City } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AppConfigService } from '../app-config/app-config.service';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { CITY_REFERENCES, CITY_RETIREMENT_MODELS } from './city-relations';

/** What a retirement is about to touch, per table, for the admin to look at. */
export interface CityRetirementImpact {
  cityId: number;
  cityName: string;
  /** Whether a destination city is required — i.e. whether the feature is on. */
  requiresDestination: boolean;
  rows: Array<{ model: string; label: string; count: number; action: 'move' | 'clear' | 'remove' }>;
}

/**
 * Cities, and the feature toggle that decides whether they exist at all
 * (v2-24, REQ-CITIES-01).
 *
 * Tenant-scoped since v2-24, which is what closed the hole this service used to
 * be: `cities` was the one global model with an `@Roles(ADMIN)` controller over
 * it, so a community's admin could read and rewrite every other community's
 * cities. There is no `tenant_id` filter written by hand anywhere below — the
 * scoping extension injects it — which is also why nothing here takes a tenant
 * id as an argument.
 */
@Injectable()
export class CitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
  ) {}

  /** Is this community using cities at all? */
  async isEnabled(): Promise<boolean> {
    return this.appConfig.isFeatureEnabled('feature_cities');
  }

  /** The cities a chooser may offer: active only, by name. */
  findAll(): Promise<City[]> {
    return this.prisma.cities.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The cities a chooser may offer **plus** the row's own current value, when
   * that value is a city that has since been retired.
   *
   * Without this, editing anything at all about a past event silently drops its
   * city: the `mat-select` is built from the active list, finds no option
   * matching the event's `cityId`, renders blank, and `Validators.min(1)` then
   * blocks a save that has nothing to do with cities. Found on stage when Rob
   * retired the day-named seed cities (recorded against this item).
   */
  async findAllForPicker(currentCityId?: number): Promise<City[]> {
    const active = await this.findAll();
    if (currentCityId === undefined || active.some((c) => c.id === currentCityId)) return active;
    const current = await this.prisma.cities.findFirst({ where: { id: currentCityId } });
    return current ? [...active, current] : active;
  }

  findAllAdmin(): Promise<City[]> {
    return this.prisma.cities.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  /**
   * Look a city up by id, **active or not**.
   *
   * Hiding a city from a *chooser* and hiding it from *resolution* are
   * different questions, and this service used to conflate them — every read
   * including this one carried `isActive: true`. That is what blanked the
   * screens on stage: `events` and `locations` load their city through the
   * foreign key, which ignores the flag, so the row kept its city and the API
   * kept returning it while every selector built from the active list had no
   * matching option.
   *
   * A retired city must stay resolvable for past events to keep the city they
   * were actually held in, which is the whole reason retiring is not deleting.
   */
  async findById(id: number): Promise<City> {
    const city = await this.prisma.cities.findFirst({ where: { id } });
    if (!city) throw new NotFoundException(`City not found: ${id}`);
    return city;
  }

  /** Same lookup, returning null rather than throwing. */
  findByIdOrNull(id: number | null | undefined): Promise<City | null> {
    if (id === null || id === undefined) return Promise.resolve(null);
    return this.prisma.cities.findFirst({ where: { id } });
  }

  /**
   * The city a row must carry, given this community's toggle.
   *
   * The requirement lives here and not in the database, because the database
   * cannot see the flag — which is why every `city_id` became nullable in
   * v2-24. Returns `null` when cities are off, so a caller can write the column
   * unconditionally.
   */
  async resolveRequiredCityId(cityId: number | null | undefined): Promise<number | null> {
    if (!(await this.isEnabled())) return null;
    if (cityId === null || cityId === undefined) {
      throw new BadRequestException('A city is required while city filtering is enabled');
    }
    const city = await this.prisma.cities.findFirst({ where: { id: cityId, isActive: true } });
    if (!city) throw new BadRequestException(`City not found or retired: ${cityId}`);
    return city.id;
  }

  /**
   * The city a brand-new member lands in: this community's first active city by
   * name, or none when cities are off.
   *
   * Settled by Rob 2026-10-14 and explicitly *not* work: this is what already
   * happened, minus the subdomain hint nobody used. There is no registration
   * prompt and no city on the invite; members change it in Profile → Settings,
   * where the option that would be wrong for them names its own city in the
   * label.
   */
  async defaultCityId(): Promise<number | null> {
    if (!(await this.isEnabled())) return null;
    const first = await this.prisma.cities.findFirst({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return first?.id ?? null;
  }

  private async assertNameAvailable(name: string, excludeId?: number): Promise<void> {
    const existing = await this.prisma.cities.findFirst({ where: { name } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`A city called '${name}' already exists`);
    }
  }

  async create(dto: CreateCityDto): Promise<City> {
    const name = dto.name.trim();
    await this.assertNameAvailable(name);
    return this.prisma.cities.create({
      data: { name, isActive: dto.isActive ?? true },
    });
  }

  /**
   * Renames or reactivates. **Retiring is not here** — it moves rows and needs
   * a destination, so it is its own route rather than an `isActive: false` that
   * looks like any other field write.
   */
  async update(id: number, dto: UpdateCityDto): Promise<City> {
    const city = await this.findById(id);
    const name = dto.name?.trim();
    if (name && name !== city.name) await this.assertNameAvailable(name, id);
    return this.prisma.cities.update({ where: { id }, data: { ...(name ? { name } : {}) } });
  }

  /** Brings a retired city back into circulation. Moves nothing. */
  async reactivate(id: number): Promise<City> {
    await this.findById(id);
    return this.prisma.cities.update({ where: { id }, data: { isActive: true } });
  }

  // ── Retirement ────────────────────────────────────────────────────────────

  /**
   * What retiring this city would touch, counted per table.
   *
   * The tables come from `city-relations.ts`, which derives them from the
   * Prisma schema rather than from a list written here — the next model to gain
   * a `city_id` is otherwise simply missed, and its rows left pointing at a
   * city no picker offers.
   */
  async retirementImpact(id: number): Promise<CityRetirementImpact> {
    const city = await this.findById(id);
    const enabled = await this.isEnabled();
    const rows: CityRetirementImpact['rows'] = [];

    for (const model of CITY_RETIREMENT_MODELS) {
      const ref = CITY_REFERENCES[model];
      const where = this.retirementWhere(model, id);
      const count = await this.delegate(model).count({ where });
      const action =
        ref.policy === 'drop' ? ('remove' as const) : enabled ? ('move' as const) : ('clear' as const);
      rows.push({ model, label: ref.label, count, action });
    }

    return {
      cityId: city.id,
      cityName: city.name,
      requiresDestination: enabled,
      rows,
    };
  }

  /**
   * Retires a city: deactivate it, and settle the rows that were pointing at
   * it. The row itself is never deleted and every foreign key onto it stays
   * valid (Rob, 2026-10-18).
   *
   * The two branches are not two implementations of one idea — they answer
   * different questions:
   *
   *  - **Cities ON.** A city is required for an event, a location and a member
   *    to function, so the forward-looking rows have to go *somewhere* and the
   *    caller names where.
   *  - **Cities OFF.** There is nowhere to move them to and nothing needs one,
   *    so they are cleared. Only possible because every `city_id` became
   *    nullable in this item.
   *
   * **Past events are untouched in both branches**, which is the point: a
   * dinner that happened in Indiana happened in Indiana.
   */
  async retire(id: number, moveToCityId?: number): Promise<CityRetirementImpact> {
    const city = await this.findById(id);
    const enabled = await this.isEnabled();

    let destination: number | null = null;
    if (enabled) {
      if (moveToCityId === undefined) {
        throw new BadRequestException(
          'Retiring a city while city filtering is on needs a city to move its rows to',
        );
      }
      if (moveToCityId === id) {
        throw new BadRequestException('A city cannot be moved to itself');
      }
      const target = await this.prisma.cities.findFirst({
        where: { id: moveToCityId, isActive: true },
      });
      if (!target) throw new BadRequestException('The destination city does not exist or is retired');
      destination = target.id;
    }

    const impact = await this.retirementImpact(id);

    // Counted before the write and reported after it, so the caller sees what
    // actually moved rather than what is left (which is zero by construction).
    //
    // **No `tenantId` predicate below, and that is a bet on the scoping
    // extension reaching inside `$transaction`.** `tenant-purge.ts` says in as
    // many words that a transaction client is not somewhere to bet on an
    // extension being applied -- so `cities.e2e-spec.ts` asserts it directly,
    // with a second community holding rows that would be destroyed if the bet
    // were wrong. The purge writes its predicate by hand instead because a
    // lost filter there empties every community; here the blast radius is
    // bounded by `cityId`, which is unique to one community's row.
    await this.prisma.$transaction(async (tx) => {
      for (const model of CITY_RETIREMENT_MODELS) {
        const ref = CITY_REFERENCES[model];
        const where = this.retirementWhere(model, id);
        const delegate = (tx as unknown as Record<string, CityDelegate>)[model];
        if (ref.policy === 'drop') {
          await delegate.deleteMany({ where });
        } else {
          await delegate.updateMany({ where, data: { cityId: destination } });
        }
      }
      await (tx as unknown as Record<string, CityDelegate>).cities.update({
        where: { id },
        data: { isActive: false },
      });
    });

    return { ...impact, cityName: city.name };
  }

  /**
   * Which rows of `model` a retirement claims.
   *
   * `move-future` is the only policy that looks at a date, and it is why this
   * is a method rather than a constant: "future" is `>= today`, read at the
   * moment of the retirement.
   */
  private retirementWhere(model: string, cityId: number): Record<string, unknown> {
    const ref = CITY_REFERENCES[model];
    if (ref.policy === 'move-future' && ref.dateField) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return { cityId, [ref.dateField]: { gte: today } };
    }
    return { cityId };
  }

  private delegate(model: string): CityDelegate {
    return (this.prisma as unknown as Record<string, CityDelegate>)[model];
  }

  // ── The feature toggle ────────────────────────────────────────────────────

  /**
   * Turns city filtering on or off for this community, settling the data in the
   * same transaction as the flag.
   *
   * **It cannot be an ordinary site setting**, which is why `feature_cities` is
   * rejected by the bulk settings write and only moves through here. Both
   * directions change rows:
   *
   *  - **On** backfills every null `city_id` to this community's first city, so
   *    a community is never observably "cities on with rows that have none" —
   *    a state the UI cannot draw and the event form refuses to save from. It
   *    is refused outright until at least one city exists, because there would
   *    be nothing to backfill to.
   *  - **Off** retires every city and clears `city_id` on **future events, all
   *    locations and all members**, leaving past events alone.
   *
   * Member preferences are dropped on the way off and not rebuilt on the way
   * back on: a set of cities is a statement about a feature that was not
   * running, and inventing one would opt members into a filter they never
   * chose. No rows means All, which is where everybody starts.
   */
  async setEnabled(enabled: boolean, userId: number): Promise<{ enabled: boolean }> {
    const current = await this.isEnabled();
    if (current === enabled) return { enabled };

    if (enabled) {
      const first = await this.prisma.cities.findFirst({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
      if (!first) {
        throw new BadRequestException(
          'Add a city before turning city filtering on — there would be nothing to file anything under',
        );
      }
      await this.prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, CityDelegate>;
        for (const model of ['events', 'locations', 'users']) {
          await t[model].updateMany({ where: { cityId: null }, data: { cityId: first.id } });
        }
      });
    } else {
      // `updateMany({ where: {} })` below is the sharpest edge in this file --
      // no predicate at all, relying entirely on the extension to add the
      // tenant inside a transaction. Asserted rather than assumed: see
      // "leaves another community data alone" in `cities.e2e-spec.ts`.
      await this.prisma.$transaction(async (tx) => {
        const t = tx as unknown as Record<string, CityDelegate>;
        await t.user_city_preferences.deleteMany({ where: {} });
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await t.events.updateMany({ where: { eventDate: { gte: today } }, data: { cityId: null } });
        await t.locations.updateMany({ where: {}, data: { cityId: null } });
        await t.users.updateMany({ where: {}, data: { cityId: null } });
        await t.cities.updateMany({ where: { isActive: true }, data: { isActive: false } });
      });
    }

    await this.appConfig.updateConfigValue('feature_cities', enabled ? 'true' : 'false', userId, {
      allowCitiesToggle: true,
    });
    return { enabled };
  }
}

/**
 * The slice of a Prisma delegate the generic walks above need.
 *
 * Structural on purpose: the models are reached by name off a DMMF-derived
 * list, so there is no single generated type that covers all of them, and
 * naming one concrete delegate would force a cast per call site instead of one
 * here. Same bargain `tenant-purge.ts` makes for the same reason.
 */
interface CityDelegate {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
}
