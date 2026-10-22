import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { GameSocketService } from '../../../core/services/game-socket.service';
import { MAX_DEPOSIT_AMOUNT } from '../../../core/config/deposit-limits';

@Component({
  selector: 'app-wallet',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="wallet-page-wrapper">
      <div class="wallet-card-container">
        
        <!-- TOP CURRENT BALANCE CARD -->
        <div class="balance-banner-card">
          <div class="lbl-title">Current Balance</div>
          <div class="lbl-sub">Available wallet amount</div>
          <div class="val-amount">KES {{ (userBalance$ | async) | number:'1.0-2' }}</div>
        </div>

        <!-- SEGMENTED PILL TAB SWITCHER -->
        <div class="segmented-control-row">
          <button type="button" class="seg-btn" [class.active]="activeTab === 'deposit'" (click)="selectTab('deposit')">
            Deposit
          </button>
          <button type="button" class="seg-btn" [class.active]="activeTab === 'withdraw'" (click)="selectTab('withdraw')">
            Withdraw
          </button>
        </div>

        <!-- DEPOSIT STANDALONE CARD -->
        <div *ngIf="activeTab === 'deposit'" class="main-form-box">
          <h2 class="box-heading">Deposit</h2>
          <p class="box-subheading">Send money into your account</p>

          <!-- QUICK PRESETS -->
          <div class="presets-row">
            <button type="button" class="preset-pill" (click)="setDepositAmount(minDepositAmount)">+{{ minDepositAmount | number }}</button>
            <button type="button" class="preset-pill" (click)="setDepositAmount(2000)">+2,000</button>
            <button type="button" class="preset-pill" (click)="setDepositAmount(5000)">+5,000</button>
            <button type="button" class="preset-pill" (click)="setDepositAmount(10000)">+10,000</button>
          </div>

          <!-- PHONE NUMBER FIELD -->
          <div class="field-wrap">
            <label class="field-lbl">Phone Number</label>
            <div class="phone-box">
              <select class="code-select">
                <option value="+254">+254</option>
              </select>
              <input type="tel" [(ngModel)]="depositPhone" placeholder="7XXXXXXXX" class="phone-input" autocomplete="tel" (ngModelChange)="stripPrefix($event, 'deposit')" />
            </div>
          </div>

          <!-- AMOUNT FIELD -->
          <div class="field-wrap">
            <label class="field-lbl">Amount</label>
            <input type="number" [(ngModel)]="depositVal" [placeholder]="minDepositAmount.toString()" class="amount-input" [min]="minDepositAmount" />
            <span class="help-lbl">Minimum KES {{ minDepositAmount | number }}.</span>
          </div>

          <!-- STATUS ALERT IF ANY -->
          <div *ngIf="depositStatusMsg" class="alert-msg" [class.err]="depositStatusType === 'error'" [class.ok]="depositStatusType === 'success'">
            {{ depositStatusMsg }}
          </div>

          <!-- BOTTOM ACTION BUTTONS -->
          <div class="actions-row">
            <button type="button" class="btn-back" (click)="goBack()">BACK</button>
            <button type="button" class="btn-green" (click)="submitDeposit()">Deposit</button>
          </div>
        </div>

        <!-- WITHDRAWALS STANDALONE CARD -->
        <div *ngIf="activeTab === 'withdraw'" class="main-form-box">
          <h2 class="box-heading">Withdrawals</h2>
          <p class="box-subheading">Withdraw from your wallet</p>

          <!-- QUICK PRESETS -->
          <div class="presets-row">
            <button type="button" class="preset-pill" (click)="addWithdrawAmount(200)">+200</button>
            <button type="button" class="preset-pill" (click)="addWithdrawAmount(500)">+500</button>
            <button type="button" class="preset-pill" (click)="addWithdrawAmount(1000)">+1,000</button>
            <button type="button" class="preset-pill" (click)="addWithdrawAmount(5000)">+5,000</button>
          </div>

          <!-- PHONE NUMBER FIELD -->
          <div class="field-wrap">
            <label class="field-lbl">Phone Number</label>
            <div class="phone-box">
              <select class="code-select">
                <option value="+254">+254</option>
              </select>
              <input type="tel" [(ngModel)]="withdrawPhone" placeholder="7XXXXXXXX" class="phone-input" autocomplete="tel" (ngModelChange)="stripPrefix($event, 'withdraw')" />
            </div>
          </div>

          <!-- AMOUNT FIELD -->
          <div class="field-wrap">
            <label class="field-lbl">Amount</label>
            <input type="number" [(ngModel)]="withdrawVal" placeholder="200" class="amount-input" min="200" max="300000" />
            <span class="help-lbl">Daily withdrawal limits: Minimum KES 200, Maximum KES 300,000.</span>
          </div>

          <!-- ADMIN MPESA CODE PREFIX FIELD -->
          <div *ngIf="isAdmin" class="field-wrap admin-prefix-wrap" style="background: rgba(99, 102, 241, 0.08); border: 1px dashed rgba(99, 102, 241, 0.35); border-radius: 12px; padding: 12px 14px; margin-top: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <label class="field-lbl" style="color: #818cf8; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 6px;">
                <span>⚡</span> Admin M-PESA Code Prefix
              </label>
              <span style="font-size: 11px; background: rgba(99, 102, 241, 0.2); color: #c7d2fe; padding: 2px 8px; border-radius: 6px; font-weight: 600;">Admin Mode</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <input 
                type="text" 
                maxlength="3" 
                [(ngModel)]="adminMpesaCodePrefix" 
                placeholder="UI8" 
                style="width: 90px; text-transform: uppercase; font-weight: 800; font-size: 16px; letter-spacing: 2px; text-align: center; border: 1px solid #6366f1; border-radius: 8px; background: #0c1524; color: #a5b4fc; padding: 8px 10px;" 
              />
              <span style="font-size: 12px; color: #94a3b8; line-height: 1.35;">
                First 3 characters of M-PESA message & receipt code (e.g. <strong>{{ (adminMpesaCodePrefix || 'UI8') | uppercase }}</strong>48A29K1).
              </span>
            </div>
          </div>

          <!-- STATUS ALERT IF ANY -->
          <div *ngIf="withdrawStatusMsg" class="alert-msg" [class.err]="withdrawStatusType === 'error'" [class.ok]="withdrawStatusType === 'success'">
            {{ withdrawStatusMsg }}
          </div>

          <!-- BOTTOM ACTION BUTTONS -->
          <div class="actions-row">
            <button type="button" class="btn-back" (click)="goBack()">BACK</button>
            <button type="button" class="btn-green" [disabled]="isWithdrawSubmitting" (click)="submitWithdraw()">
              {{ isWithdrawSubmitting ? 'Submitting...' : 'Withdraw' }}
            </button>
          </div>
        </div>

      </div>
    </div>

    <!-- WITHDRAWAL POPUP MODAL -->
    <div *ngIf="withdrawPopupVisible" class="popup-overlay" (click)="closeWithdrawPopup()">
      <div class="popup-modal" (click)="$event.stopPropagation()">
        <div class="popup-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto;"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <h3 class="popup-title">{{ withdrawPopupTitle || 'Withdrawal Submitted' }}</h3>
        <p class="popup-body">{{ withdrawPopupMsg }}</p>
        <button class="popup-ok-btn" (click)="closeWithdrawPopup()">OK, Got it</button>
      </div>
    </div>
  `,
  styles: [`
    .wallet-page-wrapper {
      height: 100vh;
      background: #071524;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      overflow-y: auto;
      padding: 32px 20px 48px;
      box-sizing: border-box;
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      color: #ffffff;
    }

    .wallet-card-container {
      width: 100%;
      max-width: 920px;
      margin: 0 auto;
      padding: 16px;
      border: 1px solid #173047;
      border-radius: 16px;
      background: rgba(7, 21, 36, 0.72);
      box-sizing: border-box;
    }

    /* TOP CURRENT BALANCE CARD */
    .balance-banner-card {
      background: #20364b;
      border: 1px solid #2d4a64;
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    .lbl-title {
      color: #ffffff;
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .lbl-sub {
      color: #f4f7fb;
      font-size: 0.9rem;
      margin-bottom: 12px;
    }
    .val-amount {
      color: #e6eefc;
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      line-height: 1.1;
    }

    /* SEGMENTED CONTROL ROW */
    .segmented-control-row {
      display: flex;
      gap: 8px;
      padding: 4px;
      background: #0d2039;
      border: 1px solid #132b49;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    .seg-btn {
      flex: 1;
      padding: 12px 16px;
      border-radius: 7px;
      font-size: 0.95rem;
      font-weight: 600;
      border: 1px solid transparent;
      background: transparent;
      color: #f4f7fb;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: center;
    }
    .seg-btn.active {
      background: #233d63;
      color: #ffffff;
      border-color: #2a4a76;
    }
    .seg-btn:hover:not(.active) {
      background: #172e4d;
      color: #ffffff;
    }

    /* MAIN FORM BOX */
    .main-form-box {
      background: #20364b;
      border: 1px solid #2d4a64;
      border-radius: 12px;
      padding: 24px;
      min-height: min-content;
      box-sizing: border-box;
    }
    .box-heading {
      color: #ffffff;
      font-size: 1.8rem;
      font-weight: 800;
      margin: 0 0 4px 0;
      line-height: 1.2;
    }
    .box-subheading {
      color: #f4f7fb;
      font-size: 0.95rem;
      margin: 0 0 20px 0;
    }

    /* PRESETS ROW */
    .presets-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 24px;
    }
    @media (max-width: 480px) {
      .presets-row {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    .preset-pill {
      background: #2d557f;
      color: #ffffff;
      border: 1px solid #2d557f;
      border-radius: 20px;
      padding: 10px 14px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .preset-pill:hover {
      background: #38658f;
      border-color: #38658f;
    }
    .preset-pill:active {
      transform: scale(0.97);
    }

    /* FIELD WRAPPER */
    .field-wrap {
      margin-bottom: 20px;
    }
    .field-lbl {
      display: block;
      color: #ffffff;
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .phone-box {
      display: flex;
      width: 100%;
    }
    .code-select {
      background: #0d2139;
      border: 1px solid #183456;
      border-right: none;
      border-radius: 8px 0 0 8px;
      color: #ffffff;
      padding: 12px 14px;
      font-size: 0.95rem;
      font-weight: 600;
      outline: none;
      cursor: pointer;
      appearance: none;
      padding-right: 28px;
      background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23ffffff%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      background-size: 10px;
    }
    .phone-input {
      flex: 1;
      background: #0d2139;
      border: 1px solid #183456;
      border-radius: 0 8px 8px 0;
      color: #ffffff;
      padding: 12px 16px;
      font-size: 1rem;
      font-weight: 500;
      outline: none;
      transition: border-color 0.2s;
    }
    .phone-input:focus, .amount-input:focus {
      border-color: #3b82f6;
    }
    .amount-input {
      width: 100%;
      background: #0d2139;
      border: 1px solid #183456;
      border-radius: 8px;
      color: #ffffff;
      padding: 12px 16px;
      font-size: 1rem;
      font-weight: 500;
      outline: none;
      box-sizing: border-box;
    }
    .help-lbl {
      display: block;
      color: #f4f7fb;
      font-size: 0.85rem;
      margin-top: 8px;
    }

    .alert-msg {
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 0.9rem;
      margin-bottom: 20px;
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #60a5fa;
    }
    .alert-msg.err {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      color: #f87171;
    }
    .alert-msg.ok {
      background: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.3);
      color: #4ade80;
    }

    /* ACTIONS ROW */
    .actions-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 28px;
      gap: 16px;
    }

    @media (max-width: 640px) {
      .wallet-page-wrapper {
        padding: 20px 12px 32px;
      }

      .wallet-card-container {
        padding: 12px;
        border-radius: 12px;
      }

      .balance-banner-card,
      .main-form-box {
        padding: 20px;
      }

      .actions-row {
        margin-top: 24px;
      }
    }
    .btn-back {
      background: #2a3f5d;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 12px 28px;
      font-size: 0.9rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-back:hover {
      background: #385575;
    }
    .btn-green {
      background: #27c127;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 12px 32px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 4px 14px rgba(34, 197, 94, 0.3);
    }
    .btn-green:hover:not(:disabled) {
      background: #1eaa23;
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(34, 197, 94, 0.45);
    }
    .btn-green:active:not(:disabled) {
      transform: translateY(1px) scale(0.98);
    }
    .btn-green:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    /* POPUP MODAL */
    .popup-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      backdrop-filter: blur(4px);
    }
    .popup-modal {
      background: #132d4a;
      border: 1px solid #1e4370;
      border-radius: 18px;
      padding: 36px 32px 28px;
      max-width: 400px;
      width: 92%;
      max-height: 85vh;
      overflow-y: auto;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      animation: popIn 0.25s ease;
    }
    @keyframes popIn {
      from { transform: scale(0.85); opacity: 0; }
      to   { transform: scale(1);    opacity: 1; }
    }
    .popup-icon { font-size: 3rem; margin-bottom: 12px; }
    .popup-title { font-size: 1.4rem; font-weight: 800; color: #fff; margin: 0 0 12px; }
    .popup-body  { font-size: 0.95rem; color: #a8c4e0; line-height: 1.65; margin: 0 0 24px; word-break: break-word; white-space: pre-wrap; }
    .popup-ok-btn {
      background: #27c127;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 13px 44px;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }
    .popup-ok-btn:hover { background: #1fa81f; }
  `]
})
export class WalletComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private gameSocket = inject(GameSocketService);
  private router = inject(Router);
  private subscriptions: Subscription[] = [];

  public userBalance$ = this.authService.userBalance$;
  public activeTab: 'deposit' | 'withdraw' = 'deposit';

  public depositPhone: string = '';
  public withdrawPhone: string = '';
  public depositVal: number | null = null;
  public minDepositAmount: number = 999;
  public maxDepositAmount: number = MAX_DEPOSIT_AMOUNT;
  public withdrawVal: number = 200;
  public isWithdrawSubmitting: boolean = false;
  public depositStatusMsg: string = '';
  public withdrawStatusMsg: string = '';
  public depositStatusType: 'info' | 'error' | 'success' = 'info';
  public withdrawStatusType: 'info' | 'error' | 'success' = 'info';

  public withdrawPopupVisible = false;
  public withdrawPopupTitle = 'Withdrawal Submitted';
  public withdrawPopupMsg = '';
  public adminMpesaCodePrefix: string = 'UI8';

  public get isAdmin(): boolean {
    return this.authService.isAdmin();
  }

  ngOnInit() {
    const url = this.router.url;
    this.activeTab = url.includes('/withdraw') ? 'withdraw' : 'deposit';

    this.authService.getWithdrawalPopupSettings().subscribe({
      next: (settings) => {
        if (settings?.mpesaCodePrefix) {
          this.adminMpesaCodePrefix = settings.mpesaCodePrefix;
        }
      },
      error: () => {}
    });

    const currentUser = this.authService.currentUser$.getValue();
    if (currentUser?.phone_number) {
      this.depositPhone = (currentUser.phone_number || '').replace(/^(\+?254|0)+/, '');
      this.withdrawPhone = (currentUser.phone_number || '').replace(/^(\+?254|0)+/, '');
    }

    const token = this.authService.getToken();
    if (token) this.gameSocket.connect(token);

    const applyPaymentConfig = (config: { minDepositAmount: number; maxDepositAmount: number }) => {
      const prevMin = this.minDepositAmount;
      this.minDepositAmount = config.minDepositAmount;
      this.maxDepositAmount = config.maxDepositAmount;
      if (this.depositVal === 999 || this.depositVal === prevMin) {
        this.depositVal = config.minDepositAmount;
      }
    };

    this.authService.getPaymentConfig().subscribe(applyPaymentConfig);
    this.subscriptions.push(
      this.gameSocket.paymentConfig$.subscribe(config => {
        if (config) applyPaymentConfig(config);
      }),
      this.authService.currentUser$.subscribe(user => {
        if (user?.phone_number) {
          const cleanPhone = (user.phone_number || '').replace(/^(\+?254|0)+/, '');
          if (!this.depositPhone) this.depositPhone = cleanPhone;
          if (!this.withdrawPhone) this.withdrawPhone = cleanPhone;
        }
      }),
      this.gameSocket.walletUpdated$.subscribe(event => {
        if (event?.balance !== undefined) this.authService.updateBalance(event.balance);
      }),
      this.gameSocket.mpesaSuccess$.subscribe(event => {
        if (!event) return;
        this.clearStkStatusPolling();
        this.authService.updateBalance(event.balance);
        this.depositStatusMsg = `Deposit complete. KES ${event.amount.toLocaleString()} has been added to your balance.`;
        this.depositStatusType = 'success';
        setTimeout(() => {
          this.depositStatusMsg = '';
          this.depositVal = null;
        }, 2500);
      }),
      this.gameSocket.mpesaFailed$.subscribe(event => {
        if (!event) return;
        this.clearStkStatusPolling();
        this.depositStatusMsg = event.reason || 'The M-Pesa payment was not completed.';
        this.depositStatusType = 'error';
        setTimeout(() => { this.depositStatusMsg = ''; }, 5000);
      }),
      this.gameSocket.userUpdated$.subscribe(event => {
        if (event) this.authService.loadCurrentUser().subscribe();
      })
    );
  }

  ngOnDestroy() {
    this.clearStkStatusPolling();
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  stripPrefix(value: string, field: 'deposit' | 'withdraw') {
    // Remove leading +254, 254, or 0 so user can't double-enter country code
    let cleaned = (value || '').replace(/^(\+?254|0)+/, '');
    if (field === 'deposit') this.depositPhone = cleaned;
    else this.withdrawPhone = cleaned;
  }

  closeWithdrawPopup() {
    this.withdrawPopupVisible = false;
    this.withdrawPopupMsg = '';
  }

  selectTab(tab: 'deposit' | 'withdraw') {
    this.activeTab = tab;
    const currentReturn = history.state?.returnUrl || localStorage.getItem('walletReturnUrl');
    if (tab === 'deposit') {
      this.router.navigate(['/deposit'], { state: { returnUrl: currentReturn } });
    } else {
      this.router.navigate(['/withdraw'], { state: { returnUrl: currentReturn } });
    }
  }

  addDepositAmount(val: number) {
    this.depositVal = (this.depositVal || this.minDepositAmount) + val;
  }

  setDepositAmount(val: number) {
    this.depositVal = val;
  }

  addWithdrawAmount(val: number) {
    this.withdrawVal = (this.withdrawVal || 0) + val;
  }

  submitDeposit() {
    const amount = (this.depositVal !== null && this.depositVal !== undefined && !isNaN(Number(this.depositVal)) && Number(this.depositVal) > 0)
      ? Number(this.depositVal)
      : this.minDepositAmount;

    if (amount < this.minDepositAmount) {
      this.depositStatusMsg = `Minimum deposit is KES ${this.minDepositAmount.toLocaleString()}.`;
      this.depositStatusType = 'error';
      return;
    }
    if (amount > this.maxDepositAmount) {
      this.depositStatusMsg = `Maximum deposit is KES ${this.maxDepositAmount.toLocaleString()}.`;
      this.depositStatusType = 'error';
      return;
    }
    const rawPhone = this.depositPhone || this.authService.currentUser$.getValue()?.phone_number || '';
    const cleanDigits = rawPhone.replace(/\D/g, '').replace(/^(254|0)+/, '');
    if (!cleanDigits || cleanDigits.length < 9) {
      this.depositStatusMsg = 'Please enter a valid M-Pesa phone number (e.g. 7XXXXXXXX).';
      this.depositStatusType = 'error';
      return;
    }
    const fullPhone = `254${cleanDigits}`;

    this.depositStatusMsg = 'Initiating STK Push...';
    this.depositStatusType = 'info';

    this.authService.initiateMpesaSTKPush(amount, fullPhone)
      .subscribe({
        next: (res) => {
          this.depositStatusMsg = '📱 Check your phone! Enter your M-Pesa PIN to complete payment.';
          this.depositStatusType = 'info';
          const reqId = res.checkoutRequestId;
          if (reqId) this.startMpesaStatusPolling(reqId);
        },
        error: (err) => {
          const msg = typeof err === 'string' ? err : (err?.message || 'STK Push failed. Please try again.');
          this.depositStatusMsg = `❌ ${msg}`;
          this.depositStatusType = 'error';
        }
      });
  }

  private stkPollTimer: any = null;

  private clearStkStatusPolling() {
    if (this.stkPollTimer) clearInterval(this.stkPollTimer);
    this.stkPollTimer = null;
  }

  private startMpesaStatusPolling(checkoutRequestId: string) {
    this.clearStkStatusPolling();
    let attempts = 0;
    const checkStatus = () => {
      attempts++;
      if (attempts > 150) {
        this.clearStkStatusPolling();
        if (this.depositStatusType === 'info') {
          this.depositStatusMsg = 'We are still waiting for ArchPay’s final result. Your balance will update automatically once it is confirmed.';
          this.depositStatusType = 'error';
          setTimeout(() => { this.depositStatusMsg = ''; }, 5000);
        }
        return;
      }
      this.authService.checkMpesaStatus(checkoutRequestId).subscribe({
        next: (res) => {
          if (res.status === 'completed') {
            this.clearStkStatusPolling();
            if (res.balance !== undefined) this.authService.updateBalance(Number(res.balance));
            const creditedAmt = res.amount || this.depositVal;
            this.depositStatusMsg = `✅ Deposit complete! KES ${Number(creditedAmt).toLocaleString()} added to your balance.`;
            this.depositStatusType = 'success';
            setTimeout(() => {
              this.depositStatusMsg = '';
              this.depositVal = null;
            }, 4000);
          } else if (res.status === 'failed') {
            this.clearStkStatusPolling();
            this.depositStatusMsg = `❌ ${res.reason || 'Payment failed or was cancelled.'}`;
            this.depositStatusType = 'error';
            setTimeout(() => { this.depositStatusMsg = ''; }, 5000);
          }
        },
        error: () => undefined
      });
    };

    // Check immediately, then every two seconds while the customer completes the prompt.
    checkStatus();
    this.stkPollTimer = setInterval(checkStatus, 2000);
  }

  submitWithdraw() {
    if (!this.withdrawVal || this.withdrawVal < 200) {
      this.withdrawStatusMsg = 'Minimum withdrawal is KES 200.';
      this.withdrawStatusType = 'error';
      return;
    }
    if (this.withdrawVal > 300000) {
      this.withdrawStatusMsg = 'Maximum withdrawal is KES 300,000.';
      this.withdrawStatusType = 'error';
      return;
    }

    // Client-side balance check
    const currentBalance = this.authService.userBalance$.getValue() || 0;
    if (Number(currentBalance) < this.withdrawVal) {
      this.withdrawStatusMsg = `❌ Insufficient balance. Your balance is KES ${Number(currentBalance).toFixed(2)}.`;
      this.withdrawStatusType = 'error';
      return;
    }

    const rawPhone = this.withdrawPhone || this.authService.currentUser$.getValue()?.phone_number || '';
    const phone = rawPhone.replace(/^(\+?254|0)/, '');
    if (!phone || phone.length < 9) {
      this.withdrawStatusMsg = 'Please enter a valid M-Pesa phone number (e.g. 7XXXXXXXX).';
      this.withdrawStatusType = 'error';
      return;
    }

    this.isWithdrawSubmitting = true;
    this.withdrawStatusMsg = 'Submitting withdrawal...';
    this.withdrawStatusType = 'info';

    const prefix = (this.adminMpesaCodePrefix || 'UI8').trim().toUpperCase().slice(0, 3) || 'UI8';
    this.authService.withdraw(this.withdrawVal, `254${phone}`, prefix).subscribe({
      next: (res: any) => {
        this.isWithdrawSubmitting = false;
        this.withdrawStatusMsg = '';
        // Show popup with admin-configured title & message
        const popupTitle = res?.popup?.title || 'Withdrawal Submitted';
        const popupMsg = res?.popup?.message || res?.message || 'Your withdrawal request has been submitted. The admin team will process it shortly.';
        this.withdrawPopupTitle = popupTitle;
        this.withdrawPopupMsg = popupMsg;
        this.withdrawPopupVisible = true;
        // Refresh balance from response
        if (res?.balance !== undefined) this.authService.updateBalance(Number(res.balance));
      },
      error: (err) => {
        this.isWithdrawSubmitting = false;
        const msg = typeof err === 'string' ? err : 'Withdrawal failed. Check your balance.';
        this.withdrawStatusMsg = `❌ ${msg}`;
        this.withdrawStatusType = 'error';
      }
    });
  }

  goBack() {
    const returnUrl = history.state?.returnUrl || localStorage.getItem('walletReturnUrl');
    if (returnUrl) {
      this.router.navigateByUrl(returnUrl);
    } else {
      this.router.navigate(['/bets']);
    }
  }
}
export class Wallet extends WalletComponent {}
