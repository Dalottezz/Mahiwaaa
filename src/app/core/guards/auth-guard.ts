import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.hasToken()) return true;

  // Carry where the visitor was heading through the sign-in detour. A shared
  // Predator link handed to a player lands here first; without this they would
  // sign up and be dropped on the game instead of the page they were sent.
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};
