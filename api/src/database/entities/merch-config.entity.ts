import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('merch_config')
export class MerchConfigEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'store_url', type: 'varchar', length: 500 })
  storeUrl: string;

  @Column({ name: 'founding_bear_product_url', type: 'varchar', length: 500, nullable: true })
  foundingBearProductUrl: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
