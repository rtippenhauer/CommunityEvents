import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CitiesService } from './cities.service';

/**
 * Which cities a member wants to see and be invited to (v2-24).
 *
 * **An empty set means every city**, which is why this is a set and not a
 * nullable column: the old `users.calendar_city_filter` enum could say "all" or
 * "my city" and could not say "Dayton and Cincinnati but not Columbus".
 *
 * One set answers three questions — the event list's default filter, the
 * personal iCal feed, and which new events earn an auto-invite email — so a
 * member states their geography once. `users.calendar_auto_invite` stayed a
 * separate on/off because it defaulted to *off* where the city filter defaulted
 * to *all*: folding it in would have read "no rows" as consent and opted in
 * every member who never touched either setting.
 *
 * **Nothing here is an access gate.** A member whose set names one city can
 * still open, RSVP to and rate an event in another; the set decides what is
 * shown and what is sent, never what is permitted.
 */
@Injectable()
export class CityPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cities: CitiesService,
  ) {}

  /** The member's chosen cities. Empty means all of them. */
  async getCityIds(userId: number): Promise<number[]> {
    if (!(await this.cities.isEnabled())) return [];
    const rows = await this.prisma.user_city_preferences.findMany({
      where: { userId },
      select: { cityId: true },
    });
    return rows.map((r) => r.cityId);
  }

  /**
   * Replaces the whole set.
   *
   * Written as delete-then-insert rather than a diff because the set is tiny
   * and the alternative has a failure mode this does not: a diff that computes
   * the removals wrongly leaves a member subscribed to a city they just
   * unticked, and a filter that silently keeps a value is the hardest kind to
   * notice.
   *
   * **Selecting every city is stored as no rows**, not as one row per city.
   * Otherwise a community adding a city would leave every member who had
   * "everything" silently excluded from it.
   */
  async setCityIds(userId: number, cityIds: number[]): Promise<number[]> {
    if (!(await this.cities.isEnabled())) {
      throw new BadRequestException('City filtering is not enabled for this community');
    }

    const unique = [...new Set(cityIds)];
    const active = await this.cities.findAll();
    const activeIds = new Set(active.map((c) => c.id));
    const unknown = unique.filter((id) => !activeIds.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Not a city of this community: ${unknown.join(', ')}`);
    }

    const stored = unique.length === active.length ? [] : unique;

    await this.prisma.$transaction(async (tx) => {
      await tx.user_city_preferences.deleteMany({ where: { userId } });
      if (stored.length > 0) {
        await tx.user_city_preferences.createMany({
          data: stored.map((cityId) => ({ userId, cityId })),
        });
      }
    });

    return stored;
  }

  /**
   * A `where` fragment for "the events this member asked to see".
   *
   * Returns `{}` for an empty set so a caller can spread it unconditionally,
   * which is what keeps the three read paths from each inventing their own
   * idea of what "all" means.
   *
   * **An event with no city is always included.** With the feature on every
   * event has one, so this only matters in the window after a community turns
   * cities on and before it has filed everything — and in that window hiding
   * events from members is worse than showing one they did not ask for.
   */
  async eventFilter(userId: number): Promise<Record<string, unknown>> {
    const cityIds = await this.getCityIds(userId);
    if (cityIds.length === 0) return {};
    return { OR: [{ cityId: { in: cityIds } }, { cityId: null }] };
  }
}
