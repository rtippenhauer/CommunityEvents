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
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { FeedbackCategory } from '../../database/entities/feedback.entity';

const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

@Controller('feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  create(@Body() dto: CreateFeedbackDto, @CurrentUser() user: UserEntity) {
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
    @CurrentUser() user: UserEntity,
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
    @CurrentUser() user: UserEntity,
    @Query('category') category?: FeedbackCategory,
    @Query('sort') sort?: 'newest' | 'upvotes',
  ) {
    return this.feedbackService.findPublic(user.id, category, sort ?? 'newest');
  }

  @Get('mine')
  findMine(@CurrentUser() user: UserEntity) {
    return this.feedbackService.findMine(user.id);
  }

  @Get('my-stats')
  getMyStats(@CurrentUser() user: UserEntity) {
    return this.feedbackService.getMemberStats(user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    return this.feedbackService.findOne(id, user.id, isAdmin);
  }

  @Post(':id/upvote')
  toggleUpvote(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.feedbackService.toggleUpvote(id, user.id);
  }

  @Get(':id/notes')
  getNotes(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    return this.feedbackService.getNotes(id, user.id, isAdmin);
  }

  @Post(':id/notes')
  addNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: UserEntity,
  ) {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot add notes');
    }
    const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    return this.feedbackService.addNote(id, user.id, dto, isAdmin);
  }
}
