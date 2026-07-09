import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MerchConfigEntity } from '../../database/entities/merch-config.entity';
import { AchievementsService } from '../community/achievements.service';
import { UpdateMerchConfigDto } from './dto/update-merch-config.dto';

const FOUNDING_BEAR_KEY = 'founding_bear';

export interface MerchLinks {
  storeUrl: string;
  foundingBearProductUrl: string | null;
}

@Injectable()
export class MerchService {
  constructor(
    @InjectRepository(MerchConfigEntity)
    private readonly merchConfigRepo: Repository<MerchConfigEntity>,
    private readonly achievementsService: AchievementsService,
  ) {}

  async getLinksForUser(userId: number): Promise<MerchLinks> {
    const config = await this.merchConfigRepo.findOne({ where: { id: 1 } });
    const storeUrl = config?.storeUrl ?? 'https://dinnerbears.printful.me/';
    if (!config?.foundingBearProductUrl) {
      return { storeUrl, foundingBearProductUrl: null };
    }
    const hasFoundingBear = await this.achievementsService.hasEarned(userId, FOUNDING_BEAR_KEY);
    return { storeUrl, foundingBearProductUrl: hasFoundingBear ? config.foundingBearProductUrl : null };
  }

  async getConfig(): Promise<MerchConfigEntity | null> {
    return this.merchConfigRepo.findOne({ where: { id: 1 } });
  }

  async updateConfig(dto: UpdateMerchConfigDto): Promise<MerchConfigEntity | null> {
    const config = await this.merchConfigRepo.findOne({ where: { id: 1 } });
    if (!config) return null;
    Object.assign(config, dto);
    return this.merchConfigRepo.save(config);
  }
}
