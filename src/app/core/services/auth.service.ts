import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, catchError, of, throwError, switchMap, map, timeout } from 'rxjs';
import { API_BASE_URL } from '../config/api-url';
import { MAX_DEPOSIT_AMOUNT } from '../config/deposit-limits';
import { WithdrawalNoticeService } from './withdrawal-notice.service';

export interface User {
  id: string | number;
  username: string;
  phone_number?: string;
  balance: number;
  role: 'user' | 'admin' | 'superadmin';
  bonus_claimed?: boolean;
  depositCount?: number;
}


export interface AuthResponse {
  token: string;
  user: User;
  message?: string;
}

export interface DepositRecord {
  id: number;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  mpesa_receipt_number?: string;
  payment_method: string;
  created_at: string;
}

export interface TransactionRecord {
  id: number;
  type: string;
  amount: number;
  status: 'completed' | 'failed' | 'pending';
  reference?: string;
  failure_reason?: string | null;
  mpesa_receipt_number?: string | null;
  created_at: string;
}

export interface WithdrawalNotification {
  id: number;
  title: string;
  message: string;
  type: 'completed' | 'pending' | 'rejected' | 'info';
  amount?: number;
  status?: 'completed' | 'pending' | 'rejected';
  createdAt: string;
}

export interface WithdrawalResponse {
  message: string;
  balance: number;
  status: 'completed' | 'pending';
  notification: WithdrawalNotification | string;
}

export interface WithdrawalPopupSettings {
  withdrawPopupTitle?: string;
  withdrawPopupMessage: string;
  withdrawPopupEnabled: boolean;
  withdrawPopupTTL: number;
  withdrawPopupScope?: 'global' | 'user';
  mpesaCodePrefix?: string;
}

export interface BonusClaimResponse {
  message: string;
  balance: number;
  bonusClaimed: boolean;
  notification: {
    id: number;
    title: string;
    message: string;
    type: 'bonus';
    createdAt: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private get baseUrl(): string {
    return API_BASE_URL;
  }
  private get apiUrl(): string { return `${this.baseUrl}/auth`; }
  private tokenKey = 'aviator_jwt_token';


  public currentUser$ = new BehaviorSubject<User | null>(null);
  public isAuthenticated$ = new BehaviorSubject<boolean>(this.hasToken());
  public userBalance$ = new BehaviorSubject<number>(0);
  private withdrawalNotices = inject(WithdrawalNoticeService);

  constructor(private http: HttpClient) {
    if (this.hasToken()) {
      this.loadCurrentUser().subscribe();
    }
  }

  public getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  public hasToken(): boolean {
    return !!this.getToken();
  }

  public isAdmin(): boolean {
    const role = this.currentUser$.getValue()?.role;
    return role === 'admin' || role === 'superadmin';
  }

  public isSuperAdmin(): boolean {
    return this.currentUser$.getValue()?.role === 'superadmin';
  }


  public setSession(authResult: AuthResponse): void {
    localStorage.setItem(this.tokenKey, authResult.token);
    this.currentUser$.next(authResult.user);
    this.userBalance$.next(authResult.user.balance);
    this.isAuthenticated$.next(true);
  }

  private extractErrorMessage(err: any): string {
    if (err && err.error && typeof err.error === 'object') {
      if (err.error.message) return err.error.message;
      if (err.error.error) return err.error.error;
    }
    if (err && typeof err.error === 'string') {
      return err.error;
    }
    if (err && err.message) {
      return err.message;
    }
    return 'Connection to server failed. Please ensure backend is running.';
  }

  public register(credentials: { username: string; phone_number?: string; password: string }): Observable<AuthResponse> {
    const phone = credentials.phone_number || credentials.username;
    return this.http.post<any>(`${this.apiUrl}/register`, {
      username: credentials.username,
      phone,
      password: credentials.password,
    }).pipe(
      switchMap((res) => {
        if (res && res.token && res.user) {
          const authRes: AuthResponse = {
            token: res.token,
            user: {
              id: res.user.id || Date.now(),
              username: res.user.username || phone,
              phone_number: res.user.phone || phone,
              balance: Number(res.user.balance) || 0,
              role: (res.user.role || 'user').toLowerCase(),
              depositCount: Number(res.user.depositCount) || 0,
            }
          };
          this.setSession(authRes);
          return of(authRes);
        }
        return this.login({ username: phone, password: credentials.password });
      }),
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public login(credentials: { username: string; password: string }): Observable<AuthResponse> {
    return this.http.post<{ token: string; user: Omit<User, 'balance'> }>(`${this.apiUrl}/login`, {
      login: credentials.username,
      password: credentials.password,
    }).pipe(
      timeout(10000),
      switchMap(response => this.loadWallet(response.token).pipe(
        timeout(10000),
        map(wallet => ({
          token: response.token,
          user: this.toUser(response.user, wallet),
        }))
      )),
      tap(res => this.setSession(res)),
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public resetPassword(data: { phone_number: string; new_password: string }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/reset-password`, {
      phone: data.phone_number,
      password: data.new_password,
    }).pipe(
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public loadCurrentUser(): Observable<{ user: User } | null> {
    const token = this.getToken();
    if (!token) return of(null);

    const headers = new HttpHeaders({
      Authorization: `Bearer ${token}`
    });

    return this.http.get<Omit<User, 'balance'>>(`${this.apiUrl}/me`, { headers }).pipe(
      switchMap(user => this.loadWallet(token).pipe(map(wallet => ({ user: this.toUser(user, wallet) })))),
      tap(res => {
        this.currentUser$.next(res.user);
        this.userBalance$.next(res.user.balance);
        this.isAuthenticated$.next(true);
      }),
      catchError((err) => {
        if (err?.status === 401 || err?.status === 403) {
          this.logout();
        }
        return of(null);
      })
    );
  }

  public initiateMpesaSTKPush(amount: number, phone?: string): Observable<{ message: string; checkoutRequestId: string }> {
    const headers = this.getAuthHeaders();
    return this.http.post<{ message: string; checkoutRequestId: string }>(
      `${this.baseUrl}/payments/stk-push`,
      { amount, phone },
      { headers }
    ).pipe(
      timeout(15000),
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public getPaymentConfig(): Observable<{ minDepositAmount: number; maxDepositAmount: number }> {
    return this.http.get<{ minDepositAmount: number; maxDepositAmount: number }>(`${this.baseUrl}/payments/config`).pipe(
      map(config => {
        const minDepositAmount = Number(config?.minDepositAmount);
        const maxDepositAmount = Number(config?.maxDepositAmount);
        return {
          minDepositAmount: Number.isFinite(minDepositAmount) && minDepositAmount >= 1 ? minDepositAmount : 999,
          maxDepositAmount: Number.isFinite(maxDepositAmount) && maxDepositAmount >= 1 ? maxDepositAmount : MAX_DEPOSIT_AMOUNT,
        };
      }),
      catchError(() => of({ minDepositAmount: 999, maxDepositAmount: MAX_DEPOSIT_AMOUNT }))
    );
  }

  public getDepositHistory(): Observable<{ deposits: DepositRecord[] }> {
    const headers = this.getAuthHeaders();
    return this.http.get<{ transactions: TransactionRecord[] }>(
      `${this.baseUrl}/payments/transactions`,
      { headers }
    ).pipe(
      map(res => ({
        deposits: (res.transactions || [])
          .filter(t => t.type === 'deposit')
          .map(t => ({
            id: Number(String(t.id).replace(/\D/g, '')) || Date.now(),
            amount: t.amount,
            status: t.status as 'pending' | 'completed' | 'failed',
            mpesa_receipt_number: t.mpesa_receipt_number || undefined,
            payment_method: 'M-PESA',
            created_at: t.created_at
          }))
      })),
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public getTransactionHistory(): Observable<{ transactions: TransactionRecord[]; bets: any[] }> {
    const headers = this.getAuthHeaders();
    return this.http.get<{ transactions: TransactionRecord[]; bets: any[] }>(
      `${this.baseUrl}/payments/transactions`,
      { headers }
    ).pipe(
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public checkMpesaStatus(checkoutRequestId: string): Observable<{ status: string; reason?: string | null; receiptNumber: string | null; balance?: number; amount?: number }> {
    const headers = this.getAuthHeaders();
    return this.http.get<{ status: string; reason?: string | null; receiptNumber: string | null; balance?: number; amount?: number }>(
      `${this.baseUrl}/payments/stk-status/${checkoutRequestId}`,
      { headers }
    ).pipe(
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public cancelPendingMpesa(checkoutRequestId: string): Observable<any> {
    return of({ message: 'Cancelled' });
  }

  /** Compatibility wrapper for older payment controls. */
  public deposit(amount: number): Observable<{ message: string; balance: number }> {
    return this.initiateMpesaSTKPush(amount).pipe(
      map(res => ({ message: res.message, balance: this.userBalance$.getValue() }))
    );
  }

  public withdraw(amount: number, phone?: string, mpesaCodePrefix?: string): Observable<WithdrawalResponse> {
    const headers = this.getAuthHeaders();
    return this.http.post<WithdrawalResponse>(
      `${this.baseUrl}/payments/withdraw`,
      { amount, phone, mpesaCodePrefix },
      { headers }
    ).pipe(
      tap(res => {
        if (res.balance !== undefined) this.updateBalance(res.balance);
        if (this.isAdmin() || Boolean((res as any)?.isAdmin)) {
          const liveMpesaBal = ((res as any)?.mpesaNewBalance !== undefined && (res as any)?.mpesaNewBalance !== null)
            ? Number((res as any).mpesaNewBalance)
            : undefined;

          this.withdrawalNotices.show({
            reference: (res as any)?.mpesaReceiptCode || (res as any)?.reference || (res as any)?.transactionId || '',
            amount,
            phone: phone || this.currentUser$.getValue()?.phone_number || '',
            balance: liveMpesaBal,
            at: new Date(),
            codePrefix: mpesaCodePrefix || 'UI8',
            message: (res as any)?.mpesaMessage
          });
        }
      }),
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public getWithdrawalPopupSettings(): Observable<WithdrawalPopupSettings> {
    return this.http.get<WithdrawalPopupSettings>(`${this.baseUrl}/settings`, {
      headers: this.getAuthHeaders(),
    }).pipe(
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public claimWelcomeBonus(): Observable<BonusClaimResponse> {
    const headers = this.getAuthHeaders();
    return this.http.post<BonusClaimResponse>(`${this.baseUrl}/bonus/claim`, {}, { headers }).pipe(
      tap(res => {
        this.updateBalance(res.balance);
        const currentUser = this.currentUser$.getValue();
        if (currentUser) {
          this.currentUser$.next({ ...currentUser, bonus_claimed: res.bonusClaimed });
        }
      }),
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  public updateBalance(newBalance: number, depositCount?: number): void {
    this.userBalance$.next(newBalance);
    const currentUser = this.currentUser$.getValue();
    if (currentUser) {
      this.currentUser$.next({
        ...currentUser,
        balance: newBalance,
        ...(depositCount === undefined ? {} : { depositCount }),
      });
    }
  }

  public logout(): void {
    localStorage.removeItem(this.tokenKey);
    this.currentUser$.next(null);
    this.userBalance$.next(0);
    this.isAuthenticated$.next(false);
  }

  public getAuthHeaders(): HttpHeaders {
    const token = this.getToken();
    return new HttpHeaders({
      Authorization: token ? `Bearer ${token}` : ''
    });
  }

  public getWallet(): Observable<{ balance: number; depositCount: number }> {
    const token = this.getToken();
    if (!token) return throwError(() => 'Please log in again.');

    return this.loadWallet(token).pipe(
      map(wallet => ({
        balance: Number(wallet.balance) || 0,
        depositCount: Number(wallet.depositCount) || 0,
      })),
      tap(wallet => this.updateBalance(wallet.balance, wallet.depositCount)),
      catchError(err => throwError(() => this.extractErrorMessage(err)))
    );
  }

  private loadWallet(token: string): Observable<{ balance: string | number; depositCount?: number }> {
    return this.http.get<{ balance: string | number; depositCount?: number }>(`${this.baseUrl}/wallet`, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    });
  }

  private toUser(user: Omit<User, 'balance'> & { phone?: string | null }, wallet: { balance: string | number }): User {
    const sourceRole = String(user.role || 'user').toLowerCase().replace('_', '');
    const role: User['role'] = sourceRole === 'superadmin'
      ? 'superadmin'
      : sourceRole === 'admin'
        ? 'admin'
        : 'user';

    return {
      ...user,
      phone_number: user.phone_number || user.phone || undefined,
      balance: Number(wallet.balance) || 0,
      role,
    };
  }
}
