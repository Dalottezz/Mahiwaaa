import { Routes } from '@angular/router';
import { AviatorComponent } from './features/game/aviator/aviator.component';
import { WalletComponent } from './features/profile/wallet/wallet.component';
import { adminGuard } from './core/guards/admin-guard';
import { authGuard } from './core/guards/auth-guard';

export const routes: Routes = [
  { path: '', component: AviatorComponent, canActivate: [authGuard] },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/auth-landing/auth-landing.component')
      .then((m) => m.AuthLandingComponent)
  },
  { path: 'play', component: AviatorComponent, canActivate: [authGuard] },
  {
    path: 'bets',
    loadComponent: () => import('./features/bets/bets.component')
      .then((module) => module.BetsComponent)
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./features/admin/source-admin.component')
      .then((module) => module.SourceAdminComponent)
  },
  {
    // Shared with players by link. Any signed-in account may open it; a
    // visitor without one is sent to sign up and returned here afterwards.
    path: 'predator',
    canActivate: [authGuard],
    loadComponent: () => import('./features/predator/predator.component')
      .then((module) => module.PredatorComponent)
  },
  { path: 'wallet', component: WalletComponent, canActivate: [authGuard] },
  { path: 'deposit', component: WalletComponent, canActivate: [authGuard] },
  { path: 'withdraw', component: WalletComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'bets' }
];
