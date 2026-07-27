import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InviteEntity } from '../../database/entities/invite.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { EmailModule } from '../email/email.module';
import { LocationsModule } from '../locations/locations.module';
import { AppConfigModule } from '../app-config/app-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InviteEntity, UserEntity, EventEntity]),
    EmailModule,
    LocationsModule,
    AppConfigModule,
  ],
  providers: [InvitesService],
  controllers: [InvitesController],
  exports: [InvitesService],
})
export class InvitesModule {}
