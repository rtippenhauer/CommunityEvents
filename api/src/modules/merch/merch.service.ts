import { Injectable } from '@nestjs/common';
import type { merch_config as MerchConfig } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AchievementsService } from '../community/achievements.service';
import { UpdateMerchConfigDto } from './dto/update-merch-config.dto';

const FOUNDING_MEMBER_KEY = 'founding_member';

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
    const hasFoundingBear = await this.achievementsService.hasEarned(userId, FOUNDING_MEMBER_KEY);
    return {
      storeUrl,
      foundingBearProductUrl: hasFoundingBear ? config.foundingBearProductUrl : null,
    };
  }

  async getConfig(): Promise<MerchConfig | null> {
    return this.prisma.merch_config.findUnique({ where: { id: 1 } });
  }

  async updateConfig(dto: UpdateMerchConfigDto): Promise<MerchConfig | null> {
    const config = await this.getConfig();
    if (!config) return null;
    return this.prisma.merch_config.update({ where: { id: 1 }, data: dto });
  }
}
