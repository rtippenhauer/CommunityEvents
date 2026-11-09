import { Injectable } from '@nestjs/common';
import type { merch_config as MerchConfig } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AchievementsService } from '../community/achievements.service';
import { UpdateMerchConfigDto } from './dto/update-merch-config.dto';

import { FOUNDING_ACHIEVEMENT_KEY } from '../../common/achievements/achievement-defaults';

export interface MerchLinks {
  storeUrl: string | null;
  foundingBearProductUrl: string | null;
}

@Injectable()
export class MerchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly achievementsService: AchievementsService,
  ) {}

  async getLinksForUser(userId: number): Promise<MerchLinks> {
    const config = await this.getConfig();
    const storeUrl = config?.storeUrl ?? null;
    if (!config?.foundingBearProductUrl) {
      return { storeUrl, foundingBearProductUrl: null };
    }
    const hasFoundingBear = await this.achievementsService.hasEarned(userId, FOUNDING_ACHIEVEMENT_KEY);
    return {
      storeUrl,
      foundingBearProductUrl: hasFoundingBear ? config.foundingBearProductUrl : null,
    };
  }

  /**
   * This community's store links.
   *
   * **Not `id: 1`** (v2-47). The row was a deployment-wide singleton pinned to
   * that id, which is why every community's Merch screen showed DinnerBears'
   * shop and any community's admin could repoint it for all of them. It is one
   * row per community now (`uq_merch_config_tenant`), found by the scoping
   * extension's own predicate rather than by a literal.
   *
   * Still nullable: `bootstrap.ts` and `tenants-admin.service.create` write the
   * row, so only a community that predates both has none.
   */
  async getConfig(): Promise<MerchConfig | null> {
    return this.prisma.merch_config.findFirst();
  }

  async updateConfig(dto: UpdateMerchConfigDto): Promise<MerchConfig | null> {
    const config = await this.getConfig();
    if (!config) return null;
    // Keyed on the id the scoped read just returned, not on a literal 1.
    return this.prisma.merch_config.update({ where: { id: config.id }, data: dto });
  }
}
