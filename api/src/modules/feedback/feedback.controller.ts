import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FeedbackCategory, UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';
import { isElevatedRole } from '../../common/utils/roles.util';

const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

@Controller('feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  create(@Body() dto: CreateFeedbackDto, @CurrentUser() user: User) {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot submit feedback');
    }
    return this.feedbackService.create(dto, user.id);
  }

  @Post('images')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dest = process.env.UPLOAD_PATH ?? '/app/uploads';
          mkdirSync(dest, { recursive: true });
          cb(null, dest);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `feedback-${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
        const ext = extname(file.originalname).toLowerCase();
        if (ALLOWED_IMAGE_MIME.includes(file.mimetype) && ALLOWED_IMAGE_EXT.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
        }
      },
    }),
  )
  uploadImage(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ): { url: string } {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot upload images');
    }
    if (!file) throw new BadRequestException('No image provided');
    return { url: `/api/uploads/${file.filename}` };
  }

  @Get()
  findAll(
    @CurrentUser() user: User,
    @Query('category') category?: FeedbackCategory,
    @Query('sort') sort?: 'newest' | 'upvotes',
  ) {
    return this.feedbackService.findPublic(user.id, category, sort ?? 'newest');
  }

  @Get('mine')
  findMine(@CurrentUser() user: User) {
    return this.feedbackService.findMine(user.id);
  }

  @Get('my-stats')
  getMyStats(@CurrentUser() user: User) {
    return this.feedbackService.getMemberStats(user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: User) {
    const isAdmin = isElevatedRole(user.role);
    return this.feedbackService.findOne(id, user.id, isAdmin);
  }

  @Post(':id/upvote')
  toggleUpvote(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: User) {
    return this.feedbackService.toggleUpvote(id, user.id);
  }

  @Get(':id/notes')
  getNotes(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: User) {
    const isAdmin = isElevatedRole(user.role);
    return this.feedbackService.getNotes(id, user.id, isAdmin);
  }

  @Post(':id/notes')
  addNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: User,
  ) {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot add notes');
    }
    const isAdmin = isElevatedRole(user.role);
    return this.feedbackService.addNote(id, user.id, dto, isAdmin);
  }
}
