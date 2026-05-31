# DinnerBears API — NestJS

## Stack
NestJS, TypeORM, MySQL 8.x, Passport.js, TypeScript strict mode
All routes: /api/v1/*
Container: NO public ports — internal Docker network only

## Module Structure
```
src/
├── modules/
│   ├── auth/            # JWT + Google/Facebook Passport strategies
│   ├── users/           # User entity, profile, invite system, deletion
│   ├── restaurants/     # Restaurant CRUD, geocoding, photo upload
│   ├── events/          # Event CRUD, RSVP, city context, Facebook posting
│   ├── announcements/   # Announcements + comments
│   ├── notifications/   # In-app notifications, push subscriptions, SSE
│   ├── email/           # Queue, dispatcher cron, Brevo + Gmail providers
│   ├── facebook/        # Graph API posting service
│   └── admin/           # Admin-only endpoints
├── common/
│   ├── decorators/      # @CurrentUser(), @Roles(), @AuditLog()
│   ├── filters/         # GlobalExceptionFilter
│   ├── guards/          # JwtAuthGuard, RolesGuard
│   ├── interceptors/    # AuditInterceptor, TransformInterceptor
│   └── pipes/           # ValidationPipe (applied globally in main.ts)
├── config/              # ConfigModule setup, typed config interfaces
└── database/
    ├── entities/        # One file per table
    └── migrations/      # TypeORM migrations (never edit DB manually)
```

## Key Patterns

### Module
```typescript
@Module({
  imports: [TypeOrmModule.forFeature([RestaurantEntity])],
  controllers: [RestaurantsController],
  providers: [RestaurantsService, GeocodingService],
  exports: [RestaurantsService],
})
export class RestaurantsModule {}
```

### Controller
```typescript
@Controller('restaurants')
@UseGuards(JwtAuthGuard)
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get()
  findAll(@Query('city') city: string): Promise<Restaurant[]> {
    return this.restaurantsService.findAll(city);
  }
}
```

### DTO with validation
```typescript
export class CreateRestaurantDto {
  @IsString() @IsNotEmpty() @MaxLength(255)
  name: string;

  @IsUrl() @IsOptional()
  websiteUrl?: string;

  @IsString() @IsNotEmpty()
  address: string;
}
```

### Entity
```typescript
@Entity('restaurants')
export class RestaurantEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @ManyToOne(() => CityEntity)
  @JoinColumn({ name: 'city_id' })
  city: CityEntity;

  @CreateDateColumn()
  createdAt: Date;
}
```

## Security Checklist for Every Endpoint
- [ ] JwtAuthGuard applied
- [ ] RolesGuard applied if restricted (moderator/admin)
- [ ] DTO validation covers all input fields
- [ ] TypeORM query (no raw SQL interpolation)
- [ ] Sensitive fields not returned in response (use class-transformer @Exclude)
- [ ] Rate limiting considered

## Email Queue
Never call EmailService directly — always use EmailQueueService.enqueue().
This ensures rate limiting and priority ordering are always applied.

## Audit Logging
Use @AuditLog() decorator or call AuditService.log() directly for key actions.
Key actions: login, logout, password change, role change, create/edit/delete events,
invite created/revoked, Facebook post triggered, account deletion.
