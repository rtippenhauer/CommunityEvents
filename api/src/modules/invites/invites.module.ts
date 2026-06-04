import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InviteEntity } from '../../database/entities/invite.entity';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';

@Module({
  imports: [TypeOrmModule.forFeature([InviteEntity])],
  providers: [InvitesService],
  controllers: [InvitesController],
  exports: [InvitesService],
})
export class InvitesModule {}
