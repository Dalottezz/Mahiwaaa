import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
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

interface PredatorResponse {
  access?: PredatorAccess;
  locked?: boolean;
  decision: {
    roundNumber: number;
    lockedCrashPoint: number | null;
    lockedAt: string | null;
    status: string;
    phase: string;
    note: string;
  };
  prediction: {
    roundNumber?: number;
    predictedCrashPoint: number;
    confidence: string;
    trend: string;
    basedOn: string;
    recommendation: string;
  };
  currentState: {
    phase: string;
    currentMultiplier: number;
    crashPoint: number | null;
    history: number[];
  };
  timestamp: string;
}

@Component({
  selector: 'app-predator',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      position: fixed;
      top: 0;
      left: 0;
      z-index: 999999;
      background: #ffffff;
      color: #000000;
      margin: 0;
      padding: 0;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .predator-screen {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      background: #ffffff;
    }

    .odds {
      font-size: clamp(3.5rem, 8vw, 6rem);
      font-weight: 500;
      color: #000000;
      letter-spacing: -0.02em;
      line-height: 1;
      text-align: center;
    }

    .status {
      font-size: clamp(1rem, 2.4vw, 1.4rem);
      font-weight: 500;
      color: #8a8f98;
      text-align: center;
    }
  `],
  template: `
    <main class="predator-screen">
      <div class="odds" *ngIf="oddsDisplay; else waiting">{{ oddsDisplay }}</div>
      <ng-template #waiting><div class="status">{{ statusText }}</div></ng-template>
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
  unlocked = false;
  isAdmin = false;
  accessExpiresAt: string | null = null;
  recentHistory: number[] = [];
  hasLoaded = false;

  get isLocked(): boolean {
    return this.data?.decision?.status?.toLowerCase() === 'locked'
      && Number.isFinite(Number(this.data?.decision?.lockedCrashPoint));
  }

  /**
   * The number on screen is only ever the engine's crash point for the round
   * that is open right now. The engine fixes that value when betting starts,
   * so it exists during betting and flying and not in the gap after a crash.
   *
   * Earlier fallbacks filled that gap with the latest entry in the crash
   * history, which is the round that has already ended, so the screen always
   * trailed the game by exactly one crash. They are left out on purpose.
   */
  get oddsDisplay(): string {
    if (this.isLocked && this.data?.decision?.lockedCrashPoint != null) {
      return `${Number(this.data.decision.lockedCrashPoint).toFixed(2)}x`;
    }
    return '';
  }

  /** Shown in place of the odds when there is no live figure to give. */
  get statusText(): string {
    if (!this.hasLoaded) return 'Connecting…';
    if (!this.unlocked) return 'Subscription required';
    return 'Waiting for next round…';
  }

  ngOnInit(): void {
    const token = this.auth.getToken();
    if (!token) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/predator' } });
      return;
    }
    this.watchRole();
    this.startLiveUpdates(token);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.subscriptions.unsubscribe();
    this.gameSocket.disconnect();
  }

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

  private startLiveUpdates(token: string): void {
    this.load();
    this.refreshTimer = setInterval(() => this.load(), 1500);

    this.gameSocket.connect(token);

    this.subscriptions.add(this.gameSocket.roundState$.subscribe(state => {
      const roundKey = `${state.roundId || ''}:${state.phase}`;
      if (!state.roundId || roundKey === this.lastRoundKey) return;
      this.lastRoundKey = roundKey;
      this.load();
    }));
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
          .map(Number)
          .filter(value => Number.isFinite(value) && value > 0)
          .slice(0, 12);
        this.data = this.unlocked ? this.normalizeResponse(data) : null;
        this.hasLoaded = true;
        this.finishRequest();
        this.cdr.detectChanges();
      },
      error: () => {
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
        roundNumber: toNumber(payload?.prediction?.roundNumber, 0),
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
