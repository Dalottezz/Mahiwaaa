import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { API_BASE_URL } from '../../core/config/api-url';
import { GameSocketService } from '../../core/services/game-socket.service';

interface PredatorResponse {
  decision?: {
    roundNumber?: number;
    lockedCrashPoint?: number | null;
    status?: string;
    phase?: string;
  };
  prediction?: {
    predictedCrashPoint?: number;
  };
  currentState?: {
    phase?: string;
    currentMultiplier?: number;
    crashPoint?: number | null;
    history?: number[];
  };
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
  `],
  template: `
    <main class="predator-screen">
      <div class="odds">{{ oddsDisplay }}</div>
    </main>
  `
})
export class PredatorComponent implements OnInit, OnDestroy {
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
  recentHistory: number[] = [];

  get oddsDisplay(): string {
    const lockedPoint = this.data?.decision?.lockedCrashPoint;
    if (lockedPoint != null && Number.isFinite(Number(lockedPoint)) && Number(lockedPoint) > 0) {
      return `${Number(lockedPoint).toFixed(2)}x`;
    }

    const predictedPoint = this.data?.prediction?.predictedCrashPoint;
    if (predictedPoint != null && Number.isFinite(Number(predictedPoint)) && Number(predictedPoint) > 0) {
      return `${Number(predictedPoint).toFixed(2)}x`;
    }

    if (this.recentHistory.length > 0 && Number.isFinite(Number(this.recentHistory[0])) && Number(this.recentHistory[0]) > 0) {
      return `${Number(this.recentHistory[0]).toFixed(2)}x`;
    }

    return '2.19x';
  }

  ngOnInit(): void {
    const token = this.auth.getToken() || '';
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

  private startLiveUpdates(token: string): void {
    this.load(token);
    this.refreshTimer = setInterval(() => this.load(token), 1500);

    this.gameSocket.connect(token || '');

    this.subscriptions.add(this.gameSocket.roundState$.subscribe(state => {
      const roundKey = `${state.roundId || ''}:${state.phase}`;
      if (!state.roundId || roundKey === this.lastRoundKey) return;
      this.lastRoundKey = roundKey;
      this.load(token);
    }));

    this.subscriptions.add(this.gameSocket.roundHistory$.subscribe(history => {
      if (Array.isArray(history) && history.length > 0) {
        this.recentHistory = history.map(Number).filter(v => Number.isFinite(v) && v > 0);
        this.cdr.detectChanges();
      }
    }));
  }

  private load(token: string): void {
    if (this.requestInFlight) {
      this.refreshQueued = true;
      return;
    }
    this.requestInFlight = true;

    const headers = token ? this.auth.getAuthHeaders() : undefined;
    this.http.get<PredatorResponse>(`${API_BASE_URL}/predator`, { headers }).subscribe({
      next: data => {
        this.data = data;
        if (Array.isArray(data?.currentState?.history) && data.currentState.history.length > 0) {
          this.recentHistory = data.currentState.history
            .map(Number)
            .filter(v => Number.isFinite(v) && v > 0);
        }
        this.finishRequest(token);
        this.cdr.detectChanges();
      },
      error: () => {
        this.finishRequest(token);
        this.cdr.detectChanges();
      }
    });
  }

  private finishRequest(token: string): void {
    this.requestInFlight = false;
    if (!this.refreshQueued) return;
    this.refreshQueued = false;
    this.load(token);
  }
}
