import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { API_BASE_URL } from '../../core/config/api-url';
import { GameSocketService } from '../../core/services/game-socket.service';

interface PredatorAccess {
  unlocked: boolean;
  isAdmin: boolean;
  expiresAt: string | null;
  code?: string | null;
  source?: string | null;
}

interface PredatorSite {
  id: string;
  name: string;
  description: string;
  logoUrl: string;
  accent: string;
  priceKes: number;
  durationHours: number;
  available: boolean;
  builtIn: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  source: string | null;
}

interface PredatorResponse {
  access?: PredatorAccess;
  locked?: boolean;
  decision: { roundNumber: number; lockedCrashPoint: number | null; lockedAt: string | null; status: string; phase: string; note: string };
  prediction: { predictedCrashPoint: number; confidence: string; trend: string; basedOn: string; recommendation: string };
  currentState: { phase: string; currentMultiplier: number; crashPoint: number | null; history: number[] };
  timestamp: string;
}

@Component({
  selector: 'app-predator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host{display:block;min-height:100vh;background:#0a0e17;color:#fff;font-family:Inter,system-ui,sans-serif}.page{max-width:1280px;margin:0 auto;padding:24px}.head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:24px}.eyebrow{color:#64748b;font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase}.head h1{color:#ff0058;font-size:34px;margin:4px 0}.sub{color:#94a3b8;margin:0}.head-actions{display:flex;gap:8px;flex-wrap:wrap}.head-actions button{background:rgba(255,255,255,.08);border:0;border-radius:10px;color:#fff;cursor:pointer;font:700 14px inherit;padding:10px 14px}.head-actions button.primary{background:#ff0058}.grid{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:16px}.stack{display:grid;gap:16px}.card{background:#111827;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:20px}.prediction{background:linear-gradient(135deg,#111827,#0f172a)}.label{color:#64748b;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase}.value{font-size:62px;font-weight:900;margin:10px 0 0}.locked{color:#22c55e}.pending{color:#facc15}.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.tag{background:rgba(255,255,255,.08);border-radius:999px;color:#cbd5e1;font-size:12px;font-weight:700;padding:6px 10px}.tag.live{background:rgba(34,197,94,.16);color:#86efac}.chart{height:170px;width:100%;margin-top:12px}.rounds{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:12px}.round{background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px;text-align:center}.round small{color:#64748b}.round strong{display:block;color:#38bdf8;margin-top:2px}.stat{align-items:center;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.08);border-radius:10px;display:flex;justify-content:space-between;margin-top:10px;padding:12px}.stat span{color:#94a3b8;font-size:12px}.stat strong{color:#60a5fa}.error{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:10px;color:#fecaca;margin-bottom:16px;padding:12px}

    /* Subscribe gate — what a player without a token sees */
    .gate{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:18px;align-items:start}
    .gate-hero{background:radial-gradient(120% 130% at 0% 0%,rgba(255,0,88,.22),transparent 55%),#111827;border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:28px}
    .gate-hero h2{font-size:32px;line-height:1.15;margin:12px 0 10px}
    .gate-hero h2 em{color:#ff0058;font-style:normal}
    .gate-hero p.lede{color:#94a3b8;margin:0 0 20px;max-width:46ch}
    .perks{display:grid;gap:10px;margin:0;padding:0;list-style:none}
    .perk{align-items:flex-start;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.07);border-radius:12px;display:flex;gap:12px;padding:12px 14px}
    .perk .dot{background:#ff0058;border-radius:50%;flex:0 0 8px;height:8px;margin-top:7px;width:8px}
    .perk strong{display:block;font-size:14px}
    .perk span{color:#94a3b8;font-size:13px}
    .gate-side{display:grid;gap:18px}
    .redeem label{color:#64748b;display:block;font-size:11px;font-weight:800;letter-spacing:2px;margin-bottom:8px;text-transform:uppercase}
    .redeem input{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);border-radius:12px;color:#fff;font:800 20px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:3px;padding:14px;text-align:center;text-transform:uppercase;width:100%}
    .redeem input:focus{border-color:#ff0058;outline:2px solid rgba(255,0,88,.35);outline-offset:1px}
    .redeem button{background:#ff0058;border:0;border-radius:12px;color:#fff;cursor:pointer;font:800 15px inherit;margin-top:12px;padding:14px;width:100%}
    .redeem button:disabled{cursor:not-allowed;opacity:.55}
    .hint{color:#64748b;font-size:12px;margin:12px 0 0}
    .notice{border-radius:10px;font-size:13px;margin-top:12px;padding:11px 12px}
    .notice.bad{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#fecaca}
    .notice.good{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);color:#bbf7d0}
    .proof{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
    .pill{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);border-radius:999px;color:#38bdf8;font-size:12px;font-weight:700;padding:5px 10px}
    .pill.high{color:#86efac}.pill.low{color:#fda4af}
    .blur{filter:blur(9px);opacity:.5;user-select:none}

    /* Brand lockup */
    .brand{align-items:center;display:flex;gap:14px}
    .brand-mark{border-radius:14px;display:block;flex:0 0 auto}

    /* Catalogue: one row per predictor, priced by the admin */
    .shop-head{align-items:center;display:flex;justify-content:space-between;gap:10px;margin-bottom:6px}
    .shop-head .balance{background:rgba(34,197,94,.14);border-radius:999px;color:#86efac;font-size:12px;font-weight:800;padding:5px 10px}
    .site{align-items:center;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:12px;padding:13px 0}
    .site-logo{align-items:center;border-radius:11px;color:#fff;display:flex;flex:0 0 48px;font-size:11px;font-weight:900;height:48px;justify-content:center;letter-spacing:.5px;overflow:hidden;text-shadow:0 1px 2px rgba(0,0,0,.35);width:48px}
    /* The supplied artwork is a wordmark on white with generous padding.
       Shown whole on a white tile it reads; cropped to fill, it does not. */
    .site-logo.has-art{background:#fff;padding:3px}
    .site-logo img{height:100%;object-fit:contain;width:100%}
    .site-copy{display:grid;flex:1 1 auto;gap:2px;min-width:0}
    .site-copy strong{font-size:14px}
    .site-copy span{color:#94a3b8;font-size:12px;overflow:hidden;text-overflow:ellipsis}
    .site-copy .site-meta{color:#cbd5e1;font-weight:700}
    .buy{background:#ff0058;border:0;border-radius:10px;color:#fff;cursor:pointer;flex:0 0 auto;font:800 13px inherit;padding:10px 14px;white-space:nowrap}
    .buy.owned{background:rgba(34,197,94,.18);color:#86efac;cursor:default}
    .buy.soon{background:rgba(255,255,255,.07);color:#94a3b8;cursor:not-allowed}
    .buy.topup{background:rgba(251,191,36,.18);color:#fbbf24}
    .buy:disabled{opacity:.9}

    /* Stacked, the token box comes first: most visitors arrive holding a code
       from the admin, and making them scroll past the pitch to type it in
       puts the pitch ahead of the thing they came to do. */
    @media(max-width:900px){.grid{grid-template-columns:1fr}.gate{grid-template-columns:1fr}.gate-side{order:-1}.rounds{grid-template-columns:repeat(4,1fr)}}
    @media(max-width:560px){.page{padding:16px}.value{font-size:48px}.gate-hero{padding:20px}.gate-hero h2{font-size:26px}}
  `],
  template: `
    <main class="page">
      <header class="head">
        <div class="brand">
          <img class="brand-mark" src="/assets/icons/betzion-app-icon.svg" alt="Betzion" width="52" height="52">
          <div>
            <div class="eyebrow">{{ isAdmin ? 'Admin analysis' : 'Next crash signals' }}</div>
            <h1>Predator</h1>
            <p class="sub">{{ unlocked ? 'Live round decision board' : 'Subscription required' }}</p>
          </div>
        </div>
        <div class="head-actions">
          <button class="primary" (click)="load()">Refresh</button>
          <button (click)="copyShareLink()">{{ shareLabel }}</button>
          <button *ngIf="isAdmin" (click)="router.navigate(['/admin'])">Admin</button>
          <button (click)="router.navigate(['/'])">Game</button>
        </div>
      </header>

      <p *ngIf="error" class="error">{{ error }}</p>

      <!-- LOCKED: subscribe landing -->
      <section class="gate" *ngIf="!unlocked">
        <article class="gate-hero">
          <div class="eyebrow">Predator subscription</div>
          <h2>Know where the round ends <em>before</em> it flies.</h2>
          <p class="lede">Predator reads the engine decision for the round that is open right now and shows you the exact crash point — not a guess, the locked number the round will resolve at.</p>
          <ul class="perks">
            <li class="perk"><span class="dot"></span><div><strong>Engine-locked crash point</strong><span>The figure for the live round, the moment betting opens.</span></div></li>
            <li class="perk"><span class="dot"></span><div><strong>Every round, automatically</strong><span>The board refreshes itself as each new round locks.</span></div></li>
            <li class="perk"><span class="dot"></span><div><strong>Full crash history</strong><span>Recent rounds and trend, so you can read the run.</span></div></li>
          </ul>
          <div class="label" style="margin-top:20px">Live right now</div>
          <div class="proof">
            <span class="pill" *ngFor="let value of recentHistory"
                  [class.high]="value >= 10" [class.low]="value <= 1.2">{{ value | number:'1.2-2' }}x</span>
            <span class="pill" *ngIf="!recentHistory.length">Waiting for rounds…</span>
          </div>
        </article>

        <aside class="gate-side">
          <ng-container *ngTemplateOutlet="catalogue"></ng-container>

          <article class="card redeem">
            <label for="predator-token">Or enter an access token</label>
            <input id="predator-token" name="predatorToken" type="text" autocomplete="off"
                   placeholder="PRD-XXXX-XXXX" maxlength="20"
                   [(ngModel)]="tokenInput" (keyup.enter)="redeem()">
            <button type="button" [disabled]="redeeming || !tokenInput.trim()" (click)="redeem()">
              {{ redeeming ? 'Checking…' : 'Unlock Predator' }}
            </button>
            <p *ngIf="redeemError" class="notice bad">{{ redeemError }}</p>
            <p *ngIf="redeemSuccess" class="notice good">{{ redeemSuccess }}</p>
            <p class="hint">Already have a code from the admin? Paste it here — it activates on your account instantly.</p>
          </article>

          <article class="card">
            <div class="label">Next round</div>
            <div class="value pending blur">?.??x</div>
            <p class="sub">Hidden until your subscription is active.</p>
          </article>
        </aside>
      </section>

      <!-- Catalogue: prices and availability are set by the admin -->
      <ng-template #catalogue>
        <article class="card shop">
          <div class="shop-head">
            <div class="label">Subscribe with your wallet</div>
            <span class="balance">KES {{ balance | number:'1.0-2' }}</span>
          </div>

          <div class="site" *ngFor="let site of sites">
            <span class="site-logo" [class.has-art]="!!site.logoUrl" [style.background]="site.logoUrl ? null : site.accent">
              <img *ngIf="site.logoUrl" [src]="site.logoUrl" [alt]="site.name" (error)="onLogoError(site)">
              <ng-container *ngIf="!site.logoUrl">{{ initials(site.name) }}</ng-container>
            </span>
            <div class="site-copy">
              <strong>{{ site.name }}</strong>
              <span>{{ site.description || (site.durationHours | number:'1.0-0') + ' hour access' }}</span>
              <span class="site-meta">{{ durationLabel(site.durationHours) }} · KES {{ site.priceKes | number:'1.0-0' }}</span>
            </div>
            <button type="button" class="buy"
                    [class.owned]="site.unlocked"
                    [class.soon]="!site.available && !site.unlocked"
                    [class.topup]="needsTopUp(site)"
                    [disabled]="site.unlocked || !site.available || subscribingId === site.id"
                    (click)="needsTopUp(site) ? goToDeposit() : subscribe(site)">
              <ng-container *ngIf="site.unlocked">{{ isAdmin ? 'Admin access' : remainingLabel(site.expiresAt) }}</ng-container>
              <ng-container *ngIf="!site.unlocked && !site.available">Coming soon</ng-container>
              <ng-container *ngIf="!site.unlocked && site.available">
                {{ subscribingId === site.id ? 'Paying…' : (needsTopUp(site) ? 'Top up' : 'Subscribe') }}
              </ng-container>
            </button>
          </div>

          <p *ngIf="!sites.length" class="hint">No predictor packages are on sale yet.</p>
          <p *ngIf="subscribeError" class="notice bad">{{ subscribeError }}</p>
          <p *ngIf="subscribeSuccess" class="notice good">{{ subscribeSuccess }}</p>
          <p class="hint" *ngIf="sites.length">Paid straight from your Betzion wallet balance. Top up on the deposit page if you are short.</p>
        </article>
      </ng-template>

      <!-- UNLOCKED: the live board -->
      <ng-container *ngIf="unlocked">
        <section class="grid" *ngIf="data; else loading">
          <div class="stack">
            <article class="card prediction">
              <div class="label">Round #{{ data.decision.roundNumber }} prediction</div>
              <div class="value" [class.locked]="isLocked" [class.pending]="!isLocked">{{ isLocked ? (data.decision.lockedCrashPoint | number:'1.2-2') + 'x' : '~' + (data.prediction.predictedCrashPoint | number:'1.2-2') + 'x' }}</div>
              <p class="sub">{{ isLocked ? 'Engine locked. This active round will resolve at this point.' : 'Waiting for the next engine lock.' }}</p>
              <div class="tags">
                <span class="tag">{{ data.decision.status | uppercase }}</span>
                <span class="tag">{{ isLocked ? '100% ENGINE LOCK' : 'ESTIMATE ONLY' }}</span>
                <span class="tag">Phase: {{ data.currentState.phase }}</span>
                <span class="tag live">{{ accessLabel }}</span>
              </div>
            </article>
            <article class="card">
              <div class="label">Recent crashes</div>
              <svg class="chart" viewBox="0 0 860 220" preserveAspectRatio="none"><defs><linearGradient id="predatorLine" x1="0" x2="1"><stop offset="0%" stop-color="#ff0058"/><stop offset="100%" stop-color="#ffd166"/></linearGradient></defs><polyline *ngIf="sparkPoints" [attr.points]="sparkPoints" fill="none" stroke="url(#predatorLine)" stroke-width="5" stroke-linecap="round"/></svg>
            </article>
            <article class="card">
              <div class="label">Recent rounds</div>
              <div class="rounds"><div class="round" *ngFor="let value of data.currentState.history | slice:0:16; let index = index"><small>#{{ index + 1 }}</small><strong>{{ value | number:'1.2-2' }}x</strong></div></div>
            </article>
          </div>
          <aside class="stack">
            <article class="card">
              <div class="label">Live status</div>
              <div class="stat"><span>Multiplier</span><strong>{{ data.currentState.currentMultiplier | number:'1.2-2' }}x</strong></div>
              <div class="stat"><span>Phase</span><strong>{{ data.currentState.phase | uppercase }}</strong></div>
              <div class="stat"><span>Updated</span><strong>{{ lastUpdated }}</strong></div>
              <div class="stat"><span>Subscription</span><strong>{{ accessLabel }}</strong></div>
            </article>
            <article class="card">
              <div class="label">Engine decision</div>
              <p class="sub">{{ data.decision.note }}</p>
              <div class="value" [class.locked]="isLocked" [class.pending]="!isLocked">{{ isLocked ? (data.decision.lockedCrashPoint | number:'1.2-2') + 'x' : 'Waiting...' }}</div>
            </article>
            <article class="card">
              <div class="label">Recommendation</div>
              <h2>{{ data.prediction.recommendation }}</h2>
              <p class="sub">{{ data.prediction.basedOn }}</p>
            </article>
            <!-- Other sites stay purchasable once Betzion is already unlocked -->
            <ng-container *ngIf="!isAdmin" [ngTemplateOutlet]="catalogue"></ng-container>
          </aside>
        </section>
        <ng-template #loading><article class="card">Loading Predator data…</article></ng-template>
      </ng-container>
    </main>
  `
})
export class PredatorComponent implements OnInit, OnDestroy {
  readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly gameSocket = inject(GameSocketService);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions = new Subscription();
  private requestInFlight = false;
  private refreshQueued = false;
  private lastRoundKey = '';
  data: PredatorResponse | null = null;
  error = '';
  lastUpdated = '';
  // Both default to the closed position so neither the signals nor the admin
  // controls can flash on screen while the first response is in flight.
  unlocked = false;
  isAdmin = false;
  accessExpiresAt: string | null = null;
  recentHistory: number[] = [];
  tokenInput = '';
  redeeming = false;
  redeemError = '';
  redeemSuccess = '';
  sites: PredatorSite[] = [];
  balance = 0;
  subscribingId: string | null = null;
  subscribeError = '';
  subscribeSuccess = '';
  shareLabel = 'Copy link';
  private shareLabelTimer: ReturnType<typeof setTimeout> | null = null;

  get isLocked(): boolean {
    return this.data?.decision?.status?.toLowerCase() === 'locked'
      && Number.isFinite(this.data.decision.lockedCrashPoint);
  }

  /** How long this visitor's access has left, for the status chip. */
  get accessLabel(): string {
    if (this.isAdmin) return 'Admin access';
    if (!this.accessExpiresAt) return 'Active';
    const msLeft = new Date(this.accessExpiresAt).getTime() - Date.now();
    if (!Number.isFinite(msLeft) || msLeft <= 0) return 'Expired';
    const days = Math.floor(msLeft / 86400000);
    const hours = Math.floor((msLeft % 86400000) / 3600000);
    const minutes = Math.floor((msLeft % 3600000) / 60000);
    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
  }

  get sparkPoints(): string {
    const history = this.data?.currentState.history.slice(0, 24).filter(value => Number.isFinite(value) && value > 0) || [];
    if (history.length < 2) return '';
    const min = Math.min(...history); const max = Math.max(...history); const range = Math.max(.5, max - min);
    return history.map((value, index) => `${(index * 860 / (history.length - 1)).toFixed(1)},${(202 - ((value - min) / range) * 184).toFixed(1)}`).join(' ');
  }

  ngOnInit(): void {
    const token = this.auth.getToken();
    if (!token) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/predator' } });
      return;
    }
    this.watchRole();
    // The guard has already confirmed a signed-in account, so fetch straight
    // away rather than waiting on the profile request that resolves the role —
    // waiting would leave the board on its loading state for every visitor.
    this.startLiveUpdates(token);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.shareLabelTimer) clearTimeout(this.shareLabelTimer);
    this.subscriptions.unsubscribe();
    this.gameSocket.disconnect();
  }

  /**
   * The page is handed to players by link, so the administrator shortcuts are
   * shown only to accounts that actually hold the role.
   */
  private watchRole(): void {
    this.subscriptions.add(this.auth.currentUser$.subscribe(user => {
      const role = String(user?.role || '').toLowerCase().replace(/[^a-z]/g, '');
      this.isAdmin = role === 'admin' || role === 'superadmin';
      this.cdr.detectChanges();
    }));
    if (!this.auth.currentUser$.getValue()) {
      this.subscriptions.add(this.auth.loadCurrentUser().subscribe());
    }
  }

  /** Badge text when a site has no logo image: up to two leading letters. */
  initials(name: string): string {
    const first = String(name || '').trim().split(/\s+/).filter(Boolean)[0] || '';
    if (!first) return '?';
    // The first word, not one letter per word: "Betika" and "Betway" both
    // reduce to "BA" otherwise, and the catalogue shows several such pairs.
    return first.slice(0, 4).toUpperCase();
  }

  /** A logo URL that will not load falls back to the initials badge. */
  onLogoError(site: PredatorSite): void {
    site.logoUrl = '';
    this.cdr.detectChanges();
  }

  durationLabel(hours: number): string {
    if (!Number.isFinite(hours)) return '';
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = hours / 24;
    return `${days % 1 === 0 ? days : days.toFixed(1)} day${days === 1 ? '' : 's'}`;
  }

  /** Short "time left" label for a package this player already holds. */
  remainingLabel(expiresAt: string | null): string {
    if (!expiresAt) return 'Active';
    const msLeft = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(msLeft) || msLeft <= 0) return 'Expired';
    const days = Math.floor(msLeft / 86400000);
    if (days > 0) return `${days}d left`;
    const hours = Math.floor(msLeft / 3600000);
    if (hours > 0) return `${hours}h left`;
    return `${Math.max(1, Math.floor(msLeft / 60000))}m left`;
  }

  /** The catalogue and its prices, both set by the administrator. */
  loadSites(): void {
    this.http.get<{ balance: number; sites: PredatorSite[] }>(
      `${API_BASE_URL}/predator/sites`,
      { headers: this.auth.getAuthHeaders() }
    ).subscribe({
      next: response => {
        this.sites = response?.sites || [];
        this.balance = Number(response?.balance) || 0;
        this.cdr.detectChanges();
      },
      error: () => undefined,
    });
  }

  /**
   * True when the package is on sale but the wallet cannot cover it. The
   * button then offers a top-up instead of a purchase that would only come
   * back as a rejection.
   */
  needsTopUp(site: PredatorSite): boolean {
    return !this.isAdmin && !site.unlocked && site.available && this.balance < Number(site.priceKes || 0);
  }

  goToDeposit(): void {
    this.router.navigate(['/deposit']);
  }

  /** Buy a package with wallet balance. */
  subscribe(site: PredatorSite): void {
    if (this.subscribingId || site.unlocked || !site.available) return;
    this.subscribingId = site.id;
    this.subscribeError = '';
    this.subscribeSuccess = '';

    this.http.post<{ message: string; balance: number; access: PredatorAccess; sites: PredatorSite[] }>(
      `${API_BASE_URL}/predator/subscribe`,
      { siteId: site.id },
      { headers: this.auth.getAuthHeaders() }
    ).subscribe({
      next: response => {
        this.subscribingId = null;
        this.subscribeSuccess = response?.message || 'Subscription active.';
        this.balance = Number(response?.balance) || 0;
        if (response?.sites) this.sites = response.sites;
        this.applyAccess(response?.access);
        this.load();
        this.cdr.detectChanges();
      },
      error: error => {
        this.subscribingId = null;
        this.subscribeError = error?.error?.message || 'Could not complete that subscription.';
        this.cdr.detectChanges();
      }
    });
  }

  /** Exchange an admin-issued code for a subscription window. */
  redeem(): void {
    const code = this.tokenInput.trim();
    if (!code || this.redeeming) return;
    this.redeeming = true;
    this.redeemError = '';
    this.redeemSuccess = '';

    this.http.post<{ message: string; access: PredatorAccess }>(
      `${API_BASE_URL}/predator/redeem`,
      { code },
      { headers: this.auth.getAuthHeaders() }
    ).subscribe({
      next: response => {
        this.redeeming = false;
        this.redeemSuccess = response?.message || 'Predator unlocked.';
        this.tokenInput = '';
        this.applyAccess(response?.access);
        this.loadSites();
        // Pull the full board immediately so the player sees the live round
        // rather than an empty panel after unlocking.
        this.load();
        this.cdr.detectChanges();
      },
      error: error => {
        this.redeeming = false;
        this.redeemError = error?.error?.message || 'Could not activate that token. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  /** Puts this page's address on the clipboard so it can be sent to players. */
  copyShareLink(): void {
    const link = `${window.location.origin}/predator`;
    const done = (label: string) => {
      this.shareLabel = label;
      if (this.shareLabelTimer) clearTimeout(this.shareLabelTimer);
      this.shareLabelTimer = setTimeout(() => {
        this.shareLabel = 'Copy link';
        this.cdr.detectChanges();
      }, 2000);
      this.cdr.detectChanges();
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(() => done('Link copied'), () => done(link));
      return;
    }
    // Older mobile browsers without the clipboard API: show the address so it
    // can be copied by hand rather than failing silently.
    done(link);
  }

  load(): void {
    if (this.requestInFlight) {
      this.refreshQueued = true;
      return;
    }
    this.requestInFlight = true;
    this.http.get<PredatorResponse>(`${API_BASE_URL}/predator`, { headers: this.auth.getAuthHeaders() }).subscribe({
      next: data => {
        this.applyAccess(data?.access);
        this.recentHistory = (data?.currentState?.history || [])
          .map(Number).filter(value => Number.isFinite(value) && value > 0).slice(0, 12);
        // A locked response carries no decision or prediction at all, so keep
        // the board empty rather than normalising placeholder signals into it.
        this.data = this.unlocked ? this.normalizeResponse(data) : null;
        this.error = '';
        this.lastUpdated = new Date().toLocaleTimeString();
        this.finishRequest();
        this.cdr.detectChanges();
      },
      error: error => {
        this.error = error?.error?.message || 'Unable to load Predator data.';
        this.finishRequest();
        this.cdr.detectChanges();
      }
    });
  }

  private applyAccess(access?: PredatorAccess): void {
    if (!access) return;
    this.unlocked = Boolean(access.unlocked);
    this.isAdmin = Boolean(access.isAdmin) || this.isAdmin;
    this.accessExpiresAt = access.expiresAt || null;
  }

  private startLiveUpdates(token: string): void {
    this.load();
    this.loadSites();
    this.refreshTimer = setInterval(() => this.load(), 1500);
    this.gameSocket.connect(token);
    this.subscriptions.add(this.gameSocket.roundState$.subscribe(state => {
      const roundKey = `${state.roundId || ''}:${state.phase}`;
      if (!state.roundId || roundKey === this.lastRoundKey) return;
      this.lastRoundKey = roundKey;
      this.load();
    }));
  }

  private finishRequest(): void {
    this.requestInFlight = false;
    if (!this.refreshQueued) return;
    this.refreshQueued = false;
    this.load();
  }

  private normalizeResponse(payload: PredatorResponse): PredatorResponse {
    const toNumber = (value: unknown, fallback: number) => {
      const numberValue = Number(value);
      return Number.isFinite(numberValue) ? numberValue : fallback;
    };
    const lockedPoint = Number(payload?.decision?.lockedCrashPoint);
    const history = Array.isArray(payload?.currentState?.history)
      ? payload.currentState.history.map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0)
      : [];

    return {
      access: payload?.access,
      locked: payload?.locked,
      decision: {
        roundNumber: toNumber(payload?.decision?.roundNumber, 0),
        lockedCrashPoint: Number.isFinite(lockedPoint) ? lockedPoint : null,
        lockedAt: payload?.decision?.lockedAt || null,
        status: payload?.decision?.status || 'completed',
        phase: payload?.decision?.phase || 'idle',
        note: payload?.decision?.note || 'Waiting for engine...',
      },
      prediction: {
        predictedCrashPoint: toNumber(payload?.prediction?.predictedCrashPoint, 1.5),
        confidence: payload?.prediction?.confidence || 'low',
        trend: payload?.prediction?.trend || 'neutral',
        basedOn: payload?.prediction?.basedOn || '',
        recommendation: payload?.prediction?.recommendation || 'Please wait',
      },
      currentState: {
        phase: payload?.currentState?.phase || 'idle',
        currentMultiplier: toNumber(payload?.currentState?.currentMultiplier, 1),
        crashPoint: Number.isFinite(Number(payload?.currentState?.crashPoint)) ? Number(payload.currentState.crashPoint) : null,
        history,
      },
      timestamp: payload?.timestamp || new Date().toISOString(),
    };
  }
}
