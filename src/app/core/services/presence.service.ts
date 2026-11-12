import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Subject } from 'rxjs';
import { API_ORIGIN } from '../config/api-url';

@Injectable({ providedIn: 'root' })
export class PresenceService {
  private socket: Socket | null = null;
  private token: string | null = null;
  private readonly walletUpdates = new Subject<{ balance: number; depositCount?: number }>();
  private readonly roundHistory = new BehaviorSubject<number[]>([]);
  readonly walletUpdates$ = this.walletUpdates.asObservable();
  readonly roundHistory$ = this.roundHistory.asObservable();

  connect(token: string): void {
    if (!token) return;
    if (this.socket && this.token === token) {
      if (!this.socket.connected) this.socket.connect();
      return;
    }

    this.disconnect();
    this.token = token;
    this.socket = io(API_ORIGIN, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    this.socket.on('connect', () => this.socket?.emit('auth', token));
    this.socket.on('wallet:update', ({ balance, depositCount }) => {
      const amount = Number(balance);
      if (Number.isFinite(amount)) this.walletUpdates.next({ balance: amount, depositCount });
    });
    this.socket.on('game:state', ({ history }) => this.updateHistory(history));
    this.socket.on('game:history', (history) => this.updateHistory(history));
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.token = null;
    this.roundHistory.next([]);
  }

  private updateHistory(history: unknown): void {
    if (Array.isArray(history)) {
      this.roundHistory.next(history.filter(value => typeof value === 'number' && Number.isFinite(value)));
    }
  }
}
