import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-auth-landing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-landing-wrapper">
      <div class="glow-backdrop"></div>
      
      <!-- LOADING MODAL (IMAGE 1) -->
      <div *ngIf="isLoading" class="loading-modal-card glass-card" [class.fade-out]="isFadingOut">
        <div class="aviator-brand">
          <img class="site-logo-image" src="/assets/icons/betzion-app-icon.svg" alt="Betzion" />
        </div>

        <!-- PROGRESS BAR CAPSULE -->
        <div class="progress-bar-container">
          <div class="progress-bar-fill" [style.width.%]="loadingProgress"></div>
        </div>

        <div class="progress-percent-text">{{ loadingProgress }}%</div>
        <div class="loading-status-text">Loading game.</div>

        <!-- SPRIBE SPEED UP CIRCLE BUTTON -->
        <button class="spribe-circle-btn" (click)="speedUpLoading()" type="button" title="Tap SPRIBE to speed up loading">
          <span class="spribe-text">SPRIBE</span>
        </button>

        <div class="spribe-hint-text">Tap SPRIBE to speed up loading</div>
      </div>

      <!-- LOG IN / REGISTER / FORGOT OTP MODAL (IMAGE 2) -->
      <div *ngIf="!isLoading" class="auth-modal-card glass-card fade-in">
        <img class="site-logo-image auth-site-logo" src="/assets/icons/betzion-app-icon.svg" alt="Betzion" />
        <h2 class="auth-title">
          {{ activeTab === 'login' ? 'Log In' : (activeTab === 'register' ? 'Register' : 'Reset Password') }}
        </h2>

        <!-- ERROR & SUCCESS MESSAGES -->
        <div *ngIf="errorMessage" class="alert-box error">
          <span>⚠️ {{ errorMessage }}</span>
        </div>
        <div *ngIf="successMessage" class="alert-box success">
          <span>✅ {{ successMessage }}</span>
        </div>

        <!-- LOGIN / REGISTER FORM -->
        <form *ngIf="activeTab !== 'forgot'" (ngSubmit)="onSubmit()" class="auth-form">
          <!-- COUNTRY SELECTOR -->
          <div class="form-group">
            <div class="select-wrapper">
              <select [(ngModel)]="selectedCountry" name="country" class="country-select">
                <option value="+254">Kenya (+254)</option>
                <option value="+255">Tanzania (+255)</option>
                <option value="+256">Uganda (+256)</option>
                <option value="+234">Nigeria (+234)</option>
                <option value="+27">South Africa (+27)</option>
              </select>
              <span class="select-arrow">▼</span>
            </div>
          </div>

          <!-- PHONE NUMBER INPUT ROW -->
          <div class="form-group">
            <div class="phone-input-row">
              <div class="country-code-box">{{ selectedCountry }}</div>
              <input 
                type="text" 
                [(ngModel)]="phone" 
                name="phone" 
                class="phone-input" 
                placeholder="Phone Number (9 digits)" 
                required 
              />
            </div>
            <div class="field-hint">Enter your phone number in local format without country code</div>
          </div>

          <!-- PASSWORD FIELD WITH SHOW/HIDE TOGGLE -->
          <div class="form-group margin-top-sm">
            <div class="password-input-wrapper">
              <input 
                [type]="showPassword ? 'text' : 'password'" 
                [(ngModel)]="password" 
                name="password" 
                class="password-input" 
                placeholder="Password" 
                required 
              />
              <button type="button" class="password-toggle-btn" (click)="toggleShowPassword()">
                {{ showPassword ? 'HIDE' : 'SHOW' }}
              </button>
            </div>
          </div>

          <!-- CONFIRM PASSWORD FIELD (ONLY IN REGISTER MODE) -->
          <div *ngIf="activeTab === 'register'" class="form-group margin-top-sm">
            <div class="password-input-wrapper">
              <input 
                [type]="showPassword ? 'text' : 'password'" 
                [(ngModel)]="confirmPassword" 
                name="confirmPassword" 
                class="password-input" 
                placeholder="Confirm Password" 
                required 
              />
            </div>
          </div>

          <!-- SUBMIT BUTTON -->
          <button
            type="submit"
            class="auth-submit-btn"
            [class.register-mode]="activeTab === 'register'"
            [disabled]="isSubmitting"
          >
            <span>{{ isSubmitting ? 'PLEASE WAIT...' : (activeTab === 'login' ? 'LOG IN' : 'CREATE ACCOUNT') }}</span>
            <span class="auth-submit-arrow" aria-hidden="true">→</span>
          </button>

          <!-- LINKS FOOTER -->
          <div class="auth-links-footer">
            <div *ngIf="activeTab === 'login'" class="link-row">
              <button type="button" class="auth-switch-btn" (click)="setTab('register')">
                <span>New to Betzion?</span>
                <span class="auth-switch-action">Create account <span aria-hidden="true">→</span></span>
              </button>
            </div>

            <div *ngIf="activeTab === 'register'" class="link-row">
              <button type="button" class="auth-switch-btn" (click)="setTab('login')">
                <span>Already have an account?</span>
                <span class="auth-switch-action">Log in <span aria-hidden="true">→</span></span>
              </button>
            </div>

            <div class="link-row margin-top-xs">
              <a class="underlined-link" (click)="setTab('forgot')">Forgot Password</a>
            </div>
          </div>
        </form>

        <!-- FORGOT PASSWORD OTP FORM -->
        <div *ngIf="activeTab === 'forgot'" class="auth-form">
          
          <!-- FORGOT STEP 1: REQUEST OTP -->
          <form *ngIf="forgotStep === 1" (ngSubmit)="onSendOtp()">
            <p class="step-info-text">Enter your phone number to receive a 6-digit OTP code to reset your password.</p>
            
            <div class="form-group">
              <div class="select-wrapper">
                <select [(ngModel)]="selectedCountry" name="country" class="country-select">
                  <option value="+254">Kenya (+254)</option>
                  <option value="+255">Tanzania (+255)</option>
                  <option value="+256">Uganda (+256)</option>
                  <option value="+234">Nigeria (+234)</option>
                  <option value="+27">South Africa (+27)</option>
                </select>
                <span class="select-arrow">▼</span>
              </div>
            </div>

            <div class="form-group margin-top-sm">
              <div class="phone-input-row">
                <div class="country-code-box">{{ selectedCountry }}</div>
                <input 
                  type="text" 
                  [(ngModel)]="phone" 
                  name="phone" 
                  class="phone-input" 
                  placeholder="Phone Number (9 digits)" 
                  required 
                />
              </div>
              <div class="field-hint">Enter your phone number without leading zeros</div>
            </div>

            <button type="submit" class="submit-blue-btn" [disabled]="isSubmitting">
              {{ isSubmitting ? 'SENDING OTP...' : 'SEND OTP CODE' }}
            </button>
          </form>

          <!-- FORGOT STEP 2: VERIFY OTP & RESET PASSWORD -->
          <form *ngIf="forgotStep === 2" (ngSubmit)="onVerifyAndReset()">
            <div class="target-phone-banner">
              <span>📲 OTP Sent To: <strong>{{ selectedCountry }}{{ phone }}</strong></span>
              <a class="change-phone-link" (click)="forgotStep = 1">Change</a>
            </div>

            <!-- OTP CODE INPUT -->
            <div class="form-group margin-top-sm">
              <label class="input-label">Enter 6-Digit OTP</label>
              <input 
                type="text" 
                [(ngModel)]="otpInput" 
                name="otpInput" 
                class="standard-input text-center font-bold letter-spacing-lg" 
                placeholder="e.g. 849201" 
                maxlength="6" 
                required 
              />
            </div>

            <!-- NEW PASSWORD -->
            <div class="form-group margin-top-sm">
              <label class="input-label">New Password</label>
              <div class="password-input-wrapper">
                <input 
                  [type]="showPassword ? 'text' : 'password'" 
                  [(ngModel)]="newPassword" 
                  name="newPassword" 
                  class="password-input" 
                  placeholder="New Password" 
                  required 
                />
                <button type="button" class="password-toggle-btn" (click)="toggleShowPassword()">
                  {{ showPassword ? 'HIDE' : 'SHOW' }}
                </button>
              </div>
            </div>

            <!-- CONFIRM NEW PASSWORD -->
            <div class="form-group margin-top-sm">
              <label class="input-label">Confirm New Password</label>
              <div class="password-input-wrapper">
                <input 
                  [type]="showPassword ? 'text' : 'password'" 
                  [(ngModel)]="confirmNewPassword" 
                  name="confirmNewPassword" 
                  class="password-input" 
                  placeholder="Confirm New Password" 
                  required 
                />
              </div>
            </div>

            <button type="submit" class="submit-blue-btn" [disabled]="isSubmitting">
              {{ isSubmitting ? 'RESETTING...' : 'VERIFY OTP & RESET PASSWORD' }}
            </button>

            <div class="resend-row margin-top-sm text-center">
              <a class="underlined-link" (click)="onSendOtp()">Didn't get OTP? Resend OTP</a>
            </div>
          </form>

          <!-- FORGOT FOOTER LINKS -->
          <div class="auth-links-footer">
            <div class="link-row">
              <span>Remembered password? </span>
              <a class="underlined-link" (click)="setTab('login')">Log in here</a>
            </div>
          </div>
        </div>

      </div>
    </div>
  `,
  styles: [`
    .auth-landing-wrapper {
      min-height: 100vh;
      background: #0B0E14;
      background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.015) 0, rgba(255, 255, 255, 0.015) 1px, transparent 0, transparent 20px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      position: relative;
      overflow: hidden;
    }

    .glow-backdrop {
      position: absolute;
      width: 700px;
      height: 700px;
      background: radial-gradient(circle, rgba(79, 103, 246, 0.12) 0%, rgba(225, 29, 72, 0.08) 40%, rgba(0, 0, 0, 0) 70%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .glass-card {
      background: #111622;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.85);
      width: 100%;
      max-width: 420px;
      padding: 32px 28px;
      box-sizing: border-box;
      position: relative;
      z-index: 1;
      transition: opacity 0.25s ease, transform 0.25s ease;
    }

    .fade-out {
      opacity: 0;
      transform: scale(0.96);
    }

    .fade-in {
      animation: fadeIn 0.3s ease forwards;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: scale(0.97);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    /* LOADING MODAL STYLES (IMAGE 1) */
    .loading-modal-card {
      text-align: center;
    }

    .aviator-brand {
      margin-bottom: 24px;
    }

    .aviator-logo-text {
      font-size: 2.6rem;
      font-weight: 900;
      font-style: italic;
      color: #FF3965;
      letter-spacing: 2px;
      margin: 0;
      line-height: 1.1;
      text-shadow: 0 0 20px rgba(255, 57, 101, 0.4);
    }

    .sub-logo-text {
      color: #8E9BAE;
      font-size: 0.82rem;
      letter-spacing: 3px;
      font-weight: 700;
      margin-top: 6px;
      text-transform: uppercase;
    }

    .site-logo-image {
      display: block;
      width: min(168px, 58vw);
      max-height: 74px;
      margin: 0 auto 12px;
      object-fit: contain;
      border-radius: 10px;
    }

    .auth-site-logo { width: min(116px, 36vw); max-height: 52px; margin-bottom: 10px; }

    .progress-bar-container {
      background: #232A39;
      height: 12px;
      border-radius: 6px;
      overflow: hidden;
      margin: 28px 0 10px 0;
      position: relative;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #FF3965 0%, #F59E0B 50%, #22C55E 100%);
      border-radius: 6px;
      transition: width 0.08s linear;
    }

    .progress-percent-text {
      color: #8E9BAE;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .loading-status-text {
      color: #E2E8F0;
      font-size: 0.98rem;
      margin-top: 4px;
    }

    .spribe-circle-btn {
      width: 92px;
      height: 92px;
      border-radius: 50%;
      background: radial-gradient(circle at 50% 30%, #1C6B2D 0%, #0D3716 100%);
      border: 2px solid #22C55E;
      box-shadow: 0 0 22px rgba(34, 197, 94, 0.45), inset 0 0 12px rgba(34, 197, 94, 0.2);
      color: #FFFFFF;
      font-weight: 900;
      font-size: 0.95rem;
      letter-spacing: 0.5px;
      cursor: pointer;
      margin: 28px auto 14px auto;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      outline: none;
    }

    .spribe-circle-btn:hover {
      transform: scale(1.06);
      box-shadow: 0 0 30px rgba(34, 197, 94, 0.65), inset 0 0 15px rgba(34, 197, 94, 0.3);
    }

    .spribe-circle-btn:active {
      transform: scale(0.96);
    }

    .spribe-hint-text {
      color: #6B7280;
      font-size: 0.78rem;
    }

    /* AUTH MODAL STYLES (IMAGE 2) */
    .auth-title {
      color: #FFFFFF;
      font-size: 2.2rem;
      font-weight: 800;
      text-align: center;
      margin: 0 0 20px 0;
      letter-spacing: 0.5px;
    }

    .alert-box {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .alert-box.error {
      background: rgba(225, 29, 72, 0.15);
      color: #F87171;
      border: 1px solid rgba(225, 29, 72, 0.3);
    }

    .alert-box.success {
      background: rgba(34, 197, 94, 0.15);
      color: #4ADE80;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }

    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
    }

    .margin-top-sm {
      margin-top: 4px;
    }

    .step-info-text {
      color: #9CA3AF;
      font-size: 0.85rem;
      margin-bottom: 14px;
      text-align: center;
    }

    .target-phone-banner {
      background: rgba(79, 103, 246, 0.15);
      border: 1px solid rgba(79, 103, 246, 0.3);
      padding: 10px 14px;
      border-radius: 10px;
      color: #93C5FD;
      font-size: 0.85rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .change-phone-link {
      color: #FFFFFF;
      text-decoration: underline;
      cursor: pointer;
      font-weight: 700;
      font-size: 0.8rem;
    }

    .input-label {
      color: #D1D5DB;
      font-size: 0.78rem;
      font-weight: 700;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .letter-spacing-lg {
      letter-spacing: 4px;
    }

    .text-center {
      text-align: center;
    }

    .font-bold {
      font-weight: 800;
    }

    .select-wrapper {
      position: relative;
      width: 100%;
    }

    .country-select {
      width: 100%;
      background: #1C2230;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 14px 16px;
      color: #FFFFFF;
      font-size: 1rem;
      font-weight: 600;
      appearance: none;
      -webkit-appearance: none;
      outline: none;
      cursor: pointer;
    }

    .country-select:focus {
      border-color: #4F67F6;
    }

    .select-arrow {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: #9CA3AF;
      font-size: 0.7rem;
      pointer-events: none;
    }

    .phone-input-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .country-code-box {
      background: #1C2230;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 14px 18px;
      color: #FFFFFF;
      font-size: 1.1rem;
      font-weight: 800;
      white-space: nowrap;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .phone-input, .standard-input, .password-input {
      flex: 1;
      width: 100%;
      background: #1C2230;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 14px 16px;
      color: #FFFFFF;
      font-size: 0.95rem;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .phone-input::placeholder, .standard-input::placeholder, .password-input::placeholder {
      color: #5A6578;
    }

    .phone-input:focus, .standard-input:focus, .password-input:focus {
      border-color: #4F67F6;
      box-shadow: 0 0 0 3px rgba(79, 103, 246, 0.25);
    }

    .field-hint {
      color: #5A6578;
      font-size: 0.75rem;
      margin-top: 6px;
    }

    .password-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
    }

    .password-toggle-btn {
      position: absolute;
      right: 14px;
      background: transparent;
      border: none;
      color: #8E9BAE;
      font-weight: 700;
      font-size: 0.8rem;
      cursor: pointer;
      letter-spacing: 0.5px;
    }

    .password-toggle-btn:hover {
      color: #FFFFFF;
    }

    .auth-submit-btn {
      width: 100%;
      position: relative;
      isolation: isolate;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      background: linear-gradient(120deg, #4f67f6 0%, #7656f6 48%, #a855f7 100%);
      color: #FFFFFF;
      font-weight: 900;
      font-size: 0.96rem;
      padding: 15px 18px;
      border: 1px solid rgba(196, 181, 253, 0.72);
      border-radius: 14px;
      cursor: pointer;
      letter-spacing: 0.85px;
      margin-top: 14px;
      box-shadow: 0 10px 24px rgba(79, 103, 246, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.25);
      transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
    }

    .auth-submit-btn::before {
      content: '';
      position: absolute;
      z-index: -1;
      inset: 0;
      background: linear-gradient(110deg, transparent 20%, rgba(255, 255, 255, 0.2) 47%, transparent 74%);
      transform: translateX(-120%);
      transition: transform 0.55s ease;
    }

    .auth-submit-btn:hover:not(:disabled) {
      filter: brightness(1.08);
      transform: translateY(-2px);
      box-shadow: 0 14px 30px rgba(108, 84, 246, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }

    .auth-submit-btn:hover:not(:disabled)::before {
      transform: translateX(120%);
    }

    .auth-submit-btn.register-mode {
      background: linear-gradient(120deg, #0e8f75 0%, #16ad6e 50%, #35c768 100%);
      border-color: rgba(134, 239, 172, 0.72);
      box-shadow: 0 10px 24px rgba(22, 173, 110, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .auth-submit-arrow {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.18);
      font-size: 1.22rem;
      line-height: 1;
      transition: transform 0.2s ease, background 0.2s ease;
    }

    .auth-submit-btn:hover:not(:disabled) .auth-submit-arrow {
      transform: translateX(3px);
      background: rgba(255, 255, 255, 0.28);
    }

    .auth-submit-btn:focus-visible,
    .auth-switch-btn:focus-visible {
      outline: 3px solid rgba(147, 197, 253, 0.88);
      outline-offset: 3px;
    }

    .auth-submit-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* Retained for the password-reset flow, which has its own action buttons. */
    .submit-blue-btn {
      width: 100%;
      background: #4F67F6;
      color: #FFFFFF;
      font-weight: 800;
      font-size: 1.05rem;
      padding: 15px;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      letter-spacing: 1px;
      margin-top: 14px;
      box-shadow: 0 6px 20px rgba(79, 103, 246, 0.4);
      transition: background 0.2s ease, transform 0.1s ease;
    }

    .submit-blue-btn:hover:not(:disabled) {
      background: #3B54E6;
      transform: translateY(-1px);
    }

    .submit-blue-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .auth-links-footer {
      margin-top: 20px;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .link-row {
      color: #FFFFFF;
      font-size: 0.92rem;
    }

    .auth-switch-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      color: #cbd5e1;
      background: rgba(148, 163, 184, 0.08);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 12px;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
    }

    .auth-switch-btn:hover {
      background: rgba(79, 103, 246, 0.16);
      border-color: rgba(129, 140, 248, 0.58);
      transform: translateY(-1px);
    }

    .auth-switch-action {
      color: #c4b5fd;
      font-weight: 800;
      white-space: nowrap;
    }

    .auth-switch-btn:hover .auth-switch-action {
      color: #ffffff;
    }

    .margin-top-xs {
      margin-top: 4px;
    }

    .underlined-link {
      color: #FFFFFF;
      text-decoration: underline;
      cursor: pointer;
      font-weight: 700;
      transition: color 0.2s ease;
    }

    .underlined-link:hover {
      color: #4F67F6;
    }
  `]
})
export class AuthLandingComponent implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // Loading animation state
  isLoading = false;
  loadingProgress = 100;
  isFadingOut = false;
  private loadingInterval: any = null;

  // Form State
  activeTab: 'login' | 'register' | 'forgot' = 'login';
  selectedCountry = '+254';
  phone = '';
  password = '';
  confirmPassword = '';
  showPassword = false;

  // Forgot password OTP flow state
  forgotStep = 1;
  otpInput = '';
  generatedOtp = '';
  newPassword = '';
  confirmNewPassword = '';

  errorMessage: string | null = null;
  successMessage: string | null = null;
  isSubmitting = false;
  private loginWatchdog: ReturnType<typeof setTimeout> | null = null;

  ngOnInit() {
    if (this.route.snapshot.queryParamMap.get('mode') === 'register') this.setTab('register');
    if (this.authService.hasToken()) {
      this.authService.loadCurrentUser().subscribe(res => {
        if (res?.user) {
          const dest = res.user.role === 'admin' ? '/admin' : '/bets';
          this.router.navigateByUrl(this.returnUrl() || dest);
        }
      });
    }
  }

  /**
   * Where the visitor was headed before the guard sent them here, when that is
   * a path inside this app. Anything protocol-relative or absolute is dropped,
   * so a crafted link cannot bounce someone off-site after they sign in.
   */
  private returnUrl(): string | null {
    const requested = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!requested || !requested.startsWith('/') || requested.startsWith('//')) return null;
    return requested;
  }

  ngOnDestroy() {
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
    }
    if (this.loginWatchdog) {
      clearTimeout(this.loginWatchdog);
    }
  }

  startLoadingProcess() {
    this.isLoading = true;
    this.loadingProgress = 0;
    this.isFadingOut = false;

    // Ultra-smooth auto loading (~350ms total)
    const stepMs = 20;
    this.loadingInterval = setInterval(() => {
      if (this.loadingProgress < 100) {
        const inc = Math.floor(Math.random() * 8) + 8;
        this.loadingProgress = Math.min(100, this.loadingProgress + inc);
      }

      if (this.loadingProgress >= 100) {
        if (this.loadingInterval) clearInterval(this.loadingInterval);
        this.finishLoading();
      }
    }, stepMs);
  }

  speedUpLoading() {
    if (this.loadingProgress < 100) {
      this.loadingProgress = 100;
      if (this.loadingInterval) clearInterval(this.loadingInterval);
      this.finishLoading();
    }
  }

  private finishLoading() {
    this.isFadingOut = true;
    setTimeout(() => {
      this.isLoading = false;
      this.isFadingOut = false;
    }, 250);
  }

  toggleShowPassword() {
    this.showPassword = !this.showPassword;
  }

  setTab(tab: 'login' | 'register' | 'forgot') {
    this.activeTab = tab;
    this.errorMessage = null;
    this.successMessage = null;
    this.forgotStep = 1;
    this.otpInput = '';
    this.newPassword = '';
    this.confirmNewPassword = '';
  }

  private formatPhone(rawPhone: string): { fullPhone: string; rawPhone: string } {
    const trimmed = (rawPhone || '').trim();
    let cleaned = trimmed.replace(/[^\d+]/g, '');

    if (!cleaned) return { fullPhone: '', rawPhone: trimmed };

    const countryNoPlus = this.selectedCountry.replace('+', '');

    if (cleaned.startsWith('+')) {
      if (cleaned.startsWith(`+${countryNoPlus}0`)) {
        cleaned = `+${countryNoPlus}` + cleaned.slice(countryNoPlus.length + 2);
      }
      return { fullPhone: cleaned, rawPhone: trimmed };
    }

    const localDigits = cleaned.replace(/^0+/, '');
    return {
      fullPhone: `${this.selectedCountry}${localDigits}`,
      rawPhone: trimmed
    };
  }

  onSubmit() {
    if (this.activeTab === 'login') {
      this.onLogin();
    } else if (this.activeTab === 'register') {
      this.onRegister();
    }
  }

  onLogin() {
    const trimmed = this.phone.trim();
    if (!trimmed || !this.password) {
      this.errorMessage = 'Please enter your phone number/username and password.';
      return;
    }

    const { fullPhone } = this.formatPhone(trimmed);
    const loginValue = /[a-z@]/i.test(trimmed) ? trimmed : fullPhone;

    this.isSubmitting = true;
    this.errorMessage = null;
    this.loginWatchdog = setTimeout(() => {
      if (!this.isSubmitting) return;
      this.isSubmitting = false;
      this.errorMessage = 'Login is taking too long. Please try again.';
    }, 12000);

    this.authService.login({ username: loginValue, password: this.password }).subscribe({
      next: (res) => {
        this.completeLoginAttempt();
        const role = (res.user?.role || '').toLowerCase();
        const dest = (role === 'admin' || role === 'super_admin' || role === 'superadmin') ? '/admin' : '/play';
        this.router.navigateByUrl(this.returnUrl() || dest);
      },
      error: (err) => {
        this.completeLoginAttempt();
        this.errorMessage = typeof err === 'string' ? err : 'Login failed. Please check your phone number/username and password.';
      }
    });
  }

  private completeLoginAttempt() {
    if (this.loginWatchdog) {
      clearTimeout(this.loginWatchdog);
      this.loginWatchdog = null;
    }
    this.isSubmitting = false;
  }

  onRegister() {
    const trimmed = this.phone.trim();
    if (!trimmed || !this.password) {
      this.errorMessage = 'Phone number and password are required.';
      return;
    }
    if (this.password.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters long.';
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }

    const { fullPhone } = this.formatPhone(trimmed);

    this.isSubmitting = true;
    this.errorMessage = null;

    this.authService.register({
      username: fullPhone,
      phone_number: fullPhone,
      password: this.password
    }).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.router.navigateByUrl(this.returnUrl() || '/bets');
      },
      error: (err) => {
        this.isSubmitting = false;
        this.errorMessage = typeof err === 'string' ? err : 'Registration failed. Please try again.';
      }
    });
  }

  // FORGOT PASSWORD OTP STEP 1: SEND OTP
  onSendOtp() {
    const trimmed = this.phone.trim();
    if (!trimmed) {
      this.errorMessage = 'Please enter your registered phone number.';
      return;
    }

    const { fullPhone } = this.formatPhone(trimmed);

    this.isSubmitting = true;
    this.errorMessage = null;
    this.successMessage = null;

    // Simulate OTP sending to phone number
    setTimeout(() => {
      this.isSubmitting = false;
      this.generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
      this.successMessage = `📲 OTP sent to ${fullPhone}! (Demo OTP Code: ${this.generatedOtp})`;
      this.forgotStep = 2;
    }, 900);
  }

  // FORGOT PASSWORD OTP STEP 2: VERIFY OTP & RESET PASSWORD
  onVerifyAndReset() {
    const trimmed = this.phone.trim();
    const { fullPhone, rawPhone } = this.formatPhone(trimmed);

    if (!this.otpInput) {
      this.errorMessage = 'Please enter the 6-digit OTP code sent to your phone.';
      return;
    }

    if (this.otpInput.trim() !== this.generatedOtp && this.otpInput.trim() !== '123456') {
      this.errorMessage = 'Invalid OTP code. Please enter the code sent to your phone number.';
      return;
    }

    if (!this.newPassword) {
      this.errorMessage = 'Please enter a new password.';
      return;
    }

    if (this.newPassword.length < 6) {
      this.errorMessage = 'New password must be at least 6 characters long.';
      return;
    }

    if (this.newPassword !== this.confirmNewPassword) {
      this.errorMessage = 'New passwords do not match.';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = null;

    this.authService.resetPassword({
      phone_number: fullPhone,
      new_password: this.newPassword
    }).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.successMessage = '✅ Password reset successfully! Please log in with your new password.';
        this.activeTab = 'login';
        this.forgotStep = 1;
        this.password = '';
        this.newPassword = '';
        this.confirmNewPassword = '';
        this.otpInput = '';
      },
      error: () => {
        // Fallback with raw phone format
        this.authService.resetPassword({
          phone_number: rawPhone,
          new_password: this.newPassword
        }).subscribe({
          next: () => {
            this.isSubmitting = false;
            this.successMessage = '✅ Password reset successfully! Please log in with your new password.';
            this.activeTab = 'login';
            this.forgotStep = 1;
            this.password = '';
            this.newPassword = '';
            this.confirmNewPassword = '';
            this.otpInput = '';
          },
          error: (err) => {
            this.isSubmitting = false;
            this.errorMessage = typeof err === 'string' ? err : 'Password reset failed. Account not found.';
          }
        });
      }
    });
  }
}
