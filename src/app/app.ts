import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { PresenceService } from './core/services/presence.service';
import { WithdrawalNoticeComponent } from './shared/withdrawal-notice/withdrawal-notice.component';

interface DeferredInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, WithdrawalNoticeComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('frontend');
  private readonly auth = inject(AuthService);
  private readonly presence = inject(PresenceService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly presenceSubscription: Subscription;
  private deferredInstallPrompt: DeferredInstallPrompt | null = null;
  showInstallPrompt = false;
  installAvailable = false;
  installHelpVisible = false;
  isStandalone = false;
  private hasShownInstallPromptForSession = false;
  private appInitialized = false;

  private readonly onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    this.deferredInstallPrompt = event as DeferredInstallPrompt;
    this.installAvailable = true;
    if (!this.isStandalone) this.showInstallPrompt = true;
    this.cdr.detectChanges();
  };
  private readonly onAppInstalled = () => {
    this.deferredInstallPrompt = null;
    this.installAvailable = false;
    this.showInstallPrompt = false;
    this.installHelpVisible = false;
    this.cdr.detectChanges();
  };

  constructor() {
    this.presenceSubscription = this.auth.currentUser$.subscribe((user) => {
      const token = this.auth.getToken();
      if (user && token) this.presence.connect(token);
      else this.presence.disconnect();
      if (!user || !token) {
        this.hasShownInstallPromptForSession = false;
        return;
      }
      if (!this.isStandalone && !this.hasShownInstallPromptForSession) {
        this.hasShownInstallPromptForSession = true;
        this.showInstallPrompt = true;
        this.installHelpVisible = false;
        if (this.appInitialized) this.cdr.detectChanges();
      }
    });
  }

  ngOnInit(): void {
    this.appInitialized = true;
    this.isStandalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    this.showInstallPrompt = !this.auth.hasToken() && !this.isStandalone;
    window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    window.addEventListener('appinstalled', this.onAppInstalled);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }

  async installApp(): Promise<void> {
    if (!this.deferredInstallPrompt) {
      this.installHelpVisible = true;
      return;
    }
    await this.deferredInstallPrompt.prompt();
    const choice = await this.deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') this.onAppInstalled();
    else this.installHelpVisible = true;
  }

  dismissInstallPrompt(): void {
    this.showInstallPrompt = false;
  }

  ngOnDestroy(): void {
    this.presenceSubscription.unsubscribe();
    this.presence.disconnect();
    window.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', this.onAppInstalled);
  }
}
