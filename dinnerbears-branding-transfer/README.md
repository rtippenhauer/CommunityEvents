# DinnerBears Branding Transfer

Copy these files into the matching paths of the target Angular project.

## Included

- `frontend/src/assets/logo.png` - transparent DinnerBears logo
- `frontend/src/styles.scss` - global Material and brand theme variables
- `frontend/src/app/app.component.html` - branded shell markup
- `frontend/src/app/app.component.scss` - branded shell, toolbar, drawer, and page strip styles
- `frontend/src/index.html` - favicon points to the logo asset
- `frontend/public/*.html` - branded static landing/legal pages

## Notes

- The Angular shell expects Material toolbar, sidenav, icon, button, select, and list modules.
- The app component template expects `isMobile()`, `isLoggedIn()`, `logout()`, `currentCity`, and `currentYear` to exist on the component class.
- If the target project keeps Angular budgets strict, raise `anyComponentStyle` to at least `8kB` warning and `12kB` error.
