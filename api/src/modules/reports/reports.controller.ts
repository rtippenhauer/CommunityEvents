import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('reports')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  create(@Body() dto: CreateReportDto, @CurrentUser() user: User) {
    return this.reportsService.create(user.id, dto);
  }

  @Get('admin/reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  getAdminReports() {
    return this.reportsService.getAdminReports();
  }

  @Get('admin/reports/pending-count')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async getPendingCount() {
    const count = await this.reportsService.getPendingCount();
    return { count };
  }

  @Patch('admin/reports/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @HttpCode(200)
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewReportDto,
    @CurrentUser() user: User,
  ) {
    return this.reportsService.review(id, user.id, dto);
  }
}
