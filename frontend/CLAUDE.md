# DinnerBears Frontend — Angular 19

## Stack
Angular 19, standalone components, Angular Material (MDC), SCSS, TypeScript strict mode

## Structure
```
src/app/
├── core/
│   ├── guards/          # AuthGuard, RoleGuard (functional CanActivateFn)
│   ├── interceptors/    # AuthInterceptor (attach token), ErrorInterceptor (401/403)
│   └── services/        # CityService, AuthService (singletons via providedIn: 'root')
├── shared/
│   ├── components/      # Reusable UI: LoadingSpinner, ConfirmDialog, NotificationBell
│   └── pipes/           # CityPipe, RelativeDatePipe
└── features/            # Lazy-loaded route groups
    ├── auth/            # login, register, password-reset
    ├── profile/         # view-profile, edit-profile, security-settings
    ├── restaurants/     # restaurant-list, restaurant-detail
    ├── events/          # event-list, event-detail, rsvp
    ├── announcements/   # announcement-list, announcement-detail
    ├── notifications/   # notification-list
    └── admin/           # admin shell + lazy sub-routes
```

## Key Patterns

### Standalone Component
```typescript
@Component({
  selector: 'app-example',
  standalone: true,
  imports: [CommonModule, MatCardModule, ReactiveFormsModule],
  templateUrl: './example.component.html',
})
export class ExampleComponent { }
```

### Reactive Form
```typescript
form = this.fb.group({
  email: ['', [Validators.required, Validators.email]],
  password: ['', [Validators.required, Validators.minLength(12)]],
});
constructor(private fb: FormBuilder) {}
```

### HTTP Service
```typescript
@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly api = '/api/v1/events';
  constructor(private http: HttpClient) {}
  getEvents(city: string): Observable<Event[]> {
    return this.http.get<Event[]>(this.api, { params: { city } });
  }
}
```

### Functional Auth Guard
```typescript
export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};
```

## Angular Material Theme
Primary: #1E4D8C (DinnerBears blue)
Accent: TBD in Phase 1
Typography: Roboto (Material default)
Import pattern: import only the specific Mat modules needed per component

## Responsive Breakpoints
- Mobile: < 768px (design here first)
- Tablet: 768px – 1279px
- Desktop: ≥ 1280px
Use BreakpointObserver from @angular/cdk/layout for runtime checks.

## City Context
CityService reads window.location.hostname to resolve subdomain.
Inject CityService wherever city context is needed.
API calls include city as a query param or header — never hardcode city strings.
