import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject } from 'rxjs';
import { API_ORIGIN } from '../config/api-url';

export type AdminRoundStatus = 'Waiting' | 'Running' | 'Crashed';
export type AdminGamePhase = 'betting' | 'flying' | 'crashed';

export interface AdminParticipant {
  username: string;
  betAmount: number;
  cashoutMultiplier: number | null;
  payoutAmount: number;
}

export interface AdminNextRound {
  roundId: number | null;
  nextRoundId: number | null;
  nextCrashPoint: number | null;
  serverSeed: string | null;
  hash: string | null;
  generatedAt: string | null;
  timeGenerated: string | null;
  bettingDurationMs: number;
  bettingClosesAt: number | null;
  countdownMs: number;
  status: AdminRoundStatus;
}

export interface AdminPreviousRound {
  roundId: number | null;
  crashPoint: number | null;
  totalBets: number;
  totalStake: number;
  totalPayout: number;
  winnerCount: number;
  loserCount: number;
  winners: AdminParticipant[];
  losers: AdminParticipant[];
}

export interface AdminCurrentRound {
  roundId: number | null;
  phase: AdminGamePhase;
  status: AdminRoundStatus;
  currentMultiplier: number;
  numberOfBets: number;
  totalStake: number;
  estimatedPayout: number;
  connectedPlayers: number;
  onlineUsers: number;
}

export interface AdminHistoryRow {
  roundId: number;
  nextCrashPoint: number;
  generatedAt: string | null;
  status: AdminRoundStatus;
}

export interface AdminSnapshot {
  nextRound: AdminNextRound;
  previousRound: AdminPreviousRound;
  currentRound: AdminCurrentRound;
  history: AdminHistoryRow[];
}

export interface AdminRealtimeEvent {
  action: string;
  userId: number | null;
  occurredAt: string;
  balance?: number;
}

export interface AdminTransactionUpdate {
  id?: string | number;
  userId: string | number;
  username?: string;
  phone?: string | null;
  type: string;
  amount: number;
  status: string;
  reference?: string;
  failureReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface NextCrashRoomState {
  roomId: number;
  armedCrashPoint: number | null;
  currentRoundCrashPoint?: number | null;
  phase?: string;
  roundNumber?: number;
}

export interface NextCrashOverridePayload {
  rooms: NextCrashRoomState[];
  limits?: { min: number; max: number };
}

const EMPTY_NEXT_ROUND: AdminNextRound = {
  roundId: null,
  nextRoundId: null,
  nextCrashPoint: null,
  serverSeed: null,
  hash: null,
  generatedAt: null,
  timeGenerated: null,
  bettingDurationMs: 0,
  bettingClosesAt: null,
  countdownMs: 0,
  status: 'Waiting'
};

const EMPTY_PREVIOUS_ROUND: AdminPreviousRound = {
  roundId: null,
  crashPoint: null,
  totalBets: 0,
  totalStake: 0,
  totalPayout: 0,
  winnerCount: 0,
  loserCount: 0,
  winners: [],
  losers: []
};

const EMPTY_CURRENT_ROUND: AdminCurrentRound = {
  roundId: null,
  phase: 'betting',
  status: 'Waiting',
  currentMultiplier: 1,
  numberOfBets: 0,
  totalStake: 0,
  estimatedPayout: 0,
  connectedPlayers: 0,
  onlineUsers: 0
};

@Injectable({
  providedIn: 'root'
})
export class AdminSocketService {
  private socket: Socket | null = null;
  private get serverUrl(): string {
    return API_ORIGIN;
  }


  public nextRound$ = new BehaviorSubject<AdminNextRound>(EMPTY_NEXT_ROUND);
  public previousRound$ = new BehaviorSubject<AdminPreviousRound>(EMPTY_PREVIOUS_ROUND);
  public currentRound$ = new BehaviorSubject<AdminCurrentRound>(EMPTY_CURRENT_ROUND);
  public history$ = new BehaviorSubject<AdminHistoryRow[]>([]);
  public isConnected$ = new BehaviorSubject<boolean>(false);
  public error$ = new BehaviorSubject<string | null>(null);
  public transactionUpdate$ = new BehaviorSubject<AdminTransactionUpdate | null>(null);
  public dashboardStatsUpdated$ = new BehaviorSubject<AdminRealtimeEvent | null>(null);
  public walletUpdated$ = new BehaviorSubject<AdminRealtimeEvent | null>(null);
  public transactionsUpdated$ = new BehaviorSubject<AdminRealtimeEvent | null>(null);
  public depositsUpdated$ = new BehaviorSubject<AdminRealtimeEvent | null>(null);
  public withdrawalsUpdated$ = new BehaviorSubject<AdminRealtimeEvent | null>(null);
  public userUpdated$ = new BehaviorSubject<AdminRealtimeEvent | null>(null);
  public activityUpdated$ = new BehaviorSubject<AdminRealtimeEvent | null>(null);
  public nextCrashOverride$ = new BehaviorSubject<NextCrashOverridePayload | null>(null);

  public connect(token: string): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.socket = io(this.serverUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    this.socket.on('connect', () => {
      this.isConnected$.next(true);
      this.error$.next(null);
    });

    this.socket.on('connect_error', (err: Error) => {
      this.isConnected$.next(false);
      this.error$.next(err.message || 'Admin socket connection failed.');
    });

    this.socket.on('admin_snapshot', (snapshot: AdminSnapshot) => {
      this.applySnapshot(snapshot);
    });

    this.socket.on('admin_round_generated', (snapshot: AdminSnapshot) => {
      this.applySnapshot(snapshot);
    });

    this.socket.on('admin_betting_countdown', (data: Pick<AdminNextRound, 'roundId' | 'countdownMs' | 'bettingClosesAt'>) => {
      const current = this.nextRound$.getValue();
      if (current.roundId === data.roundId) {
        this.nextRound$.next({
          ...current,
          countdownMs: data.countdownMs,
          bettingClosesAt: data.bettingClosesAt
        });
      }
    });

    this.socket.on('admin_round_status', (data: {
      roundId: number;
      status: AdminRoundStatus;
      phase: AdminGamePhase;
      currentMultiplier: number;
      crashPoint: number | null;
      history: AdminHistoryRow[];
    }) => {
      const nextRound = this.nextRound$.getValue();
      if (nextRound.roundId === data.roundId) {
        this.nextRound$.next({
          ...nextRound,
          status: data.status,
          countdownMs: data.status === 'Waiting' ? nextRound.countdownMs : 0
        });
      }

      const currentRound = this.currentRound$.getValue();
      this.currentRound$.next({
        ...currentRound,
        roundId: data.roundId,
        phase: data.phase,
        status: data.status,
        currentMultiplier: data.crashPoint ?? data.currentMultiplier
      });
      this.history$.next(data.history);
    });

    this.socket.on('admin_current_round', (currentRound: AdminCurrentRound) => {
      this.currentRound$.next(currentRound);
    });

    this.socket.on('admin_previous_round', (data: { previousRound: AdminPreviousRound }) => {
      this.previousRound$.next(data.previousRound);
    });

    this.socket.on('admin_transaction_update', (data: AdminTransactionUpdate) => {
      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin socket received: admin_transaction_update`, data);
      this.transactionUpdate$.next(data);
    });

    this.socket.on('dashboard_stats_updated', (data: AdminRealtimeEvent) => {
      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin socket received: dashboard_stats_updated`, data);
      this.dashboardStatsUpdated$.next(data);
    });

    this.socket.on('wallet_updated', (data: AdminRealtimeEvent) => {
      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin socket received: wallet_updated`, data);
      this.walletUpdated$.next(data);
    });

    this.socket.on('transactions_updated', (data: AdminRealtimeEvent) => {
      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin socket received: transactions_updated`, data);
      this.transactionsUpdated$.next(data);
    });

    this.socket.on('deposits_updated', (data: AdminRealtimeEvent) => {
      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin socket received: deposits_updated`, data);
      this.depositsUpdated$.next(data);
    });

    this.socket.on('withdrawals_updated', (data: AdminRealtimeEvent) => {
      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin socket received: withdrawals_updated`, data);
      this.withdrawalsUpdated$.next(data);
    });

    this.socket.on('user_updated', (data: AdminRealtimeEvent) => {
      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin socket received: user_updated`, data);
      this.userUpdated$.next(data);
    });

    this.socket.on('activity_updated', (data: AdminRealtimeEvent) => {
      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin socket received: activity_updated`, data);
      this.activityUpdated$.next(data);
    });

    this.socket.on('next_crash_override', (data: NextCrashOverridePayload) => {
      if (data && Array.isArray(data.rooms)) {
        this.nextCrashOverride$.next(data);
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      this.isConnected$.next(false);
      if (reason !== 'io client disconnect') {
        this.error$.next(`Admin socket disconnected (${reason}). Reconnecting…`);
      }
    });
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected$.next(false);
  }

  private applySnapshot(snapshot: AdminSnapshot): void {
    this.nextRound$.next(snapshot.nextRound);
    this.previousRound$.next(snapshot.previousRound);
    this.currentRound$.next(snapshot.currentRound);
    this.history$.next(snapshot.history);
  }
}
