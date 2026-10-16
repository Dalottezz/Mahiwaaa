import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService, User } from '../../core/services/auth.service';
import { MAX_PLAY_BALANCE, PLAY_LIMIT_MESSAGE } from '../../core/config/play-limits';

interface FootballMatch {
  id: string;
  league: string;
  time: string;
  home: string;
  away: string;
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
  marketsCount: number;
  state: 'all' | 'live' | 'upcoming';
}

interface BetSlipSelection {
  matchId: string;
  matchLabel: string;
  outcome: 'home' | 'draw' | 'away';
  outcomeLabel: string;
  odds: number;
}

@Component({
  selector: 'app-bets',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bets.component.html',
  styleUrl: './bets.component.css'
})
export class BetsComponent implements OnInit, OnDestroy {
  readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly subscriptions: Subscription[] = [];
  private oddsTickerTimer: any = null;

  readonly currentUser = signal<User | null>(null);
  readonly userBalance = signal(0);
  readonly activeFilter = signal<'all' | 'live' | 'upcoming'>('all');
  readonly activeNavTab = signal<string>('home');
  readonly selectedSport = signal<string>('soccer');
  readonly selections = signal<BetSlipSelection[]>([]);
  readonly showProfileMenu = signal(false);
  readonly mobileMenuOpen = signal(false);
  readonly showMyBetsModal = signal(false);
  readonly showAccountModal = signal(false);
  readonly myBetsTab = signal<'active' | 'settled'>('active');

  stake = 20;
  betslipCode = '';

  readonly promoImages = [
    { title: 'WELCOME TO BETZION', tag: 'KSH 3,500 WELCOME BONUS!', img: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=80' },
    { title: 'BETZION AVIATOR', tag: 'MULTIPLIER UP TO 10,000X WEEKLY', img: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?auto=format&fit=crop&w=1200&q=80' },
    { title: 'HIGHEST FOOTBALL ODDS', tag: 'FASTEST M-PESA PAYOUTS', img: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1200&q=80' }
  ];

  readonly sportsList = [
    { id: 'soccer', name: 'Soccer', count: 179 },
    { id: 'table-tennis', name: 'Table Tennis', count: 24 },
    { id: 'boxing', name: 'Boxing', count: 8 },
    { id: 'aussie-rules', name: 'Aussie Rules', count: 5 },
    { id: 'rugby', name: 'Rugby', count: 12 },
    { id: 'cricket', name: 'Cricket', count: 15 },
    { id: 'baseball', name: 'Baseball', count: 9 },
    { id: 'basketball', name: 'Basketball', count: 42 },
    { id: 'mma', name: 'MMA', count: 7 },
    { id: 'tennis', name: 'Tennis', count: 31 },
    { id: 'esport-kog', name: 'eSport King of Glory', count: 6 },
    { id: 'esport-lol', name: 'eSport League of Legends', count: 14 },
    { id: 'esport-cs', name: 'eSport Counter-Strike', count: 18 },
    { id: 'esport-cod', name: 'eSport Call of Duty', count: 4 },
    { id: 'esoccer', name: 'eSoccer', count: 28 },
    { id: 'ice-hockey', name: 'Ice Hockey', count: 11 },
    { id: 'american-football', name: 'American Football', count: 16 },
    { id: 'beach-volley', name: 'Beach Volley', count: 3 },
    { id: 'handball', name: 'Handball', count: 9 },
    { id: 'zoom-soccer', name: 'Zoom Soccer', count: 55 },
    { id: 'darts', name: 'Darts', count: 10 }
  ];

  matchesList = signal<FootballMatch[]>([
    { id: 'm1', league: 'European Club Series', time: "71'", home: 'River Plate Town', away: 'Orchard Vale', homeOdds: 2.06, drawOdds: 3.23, awayOdds: 3.20, marketsCount: 49, state: 'live' },
    { id: 'm2', league: 'Kenya National League', time: "72'", home: 'Capital City', away: 'Lake Warriors', homeOdds: 3.28, drawOdds: 3.24, awayOdds: 1.91, marketsCount: 38, state: 'live' },
    { id: 'm3', league: 'East Africa Cup', time: "36'", home: 'Coastal Stars', away: 'Highland FC', homeOdds: 2.18, drawOdds: 2.64, awayOdds: 3.26, marketsCount: 35, state: 'live' },
    { id: 'm4', league: 'European Club Series', time: "85'", home: 'Metro Athletic', away: 'Harbour Town', homeOdds: 1.95, drawOdds: 3.16, awayOdds: 4.17, marketsCount: 51, state: 'live' },
    { id: 'm5', league: 'East Africa Cup', time: "82'", home: 'Sunrise United', away: 'Kilimani FC', homeOdds: 2.54, drawOdds: 2.70, awayOdds: 2.67, marketsCount: 42, state: 'live' },
    { id: 'm6', league: 'Zona Premier', time: "44'", home: 'Godaba FC', away: 'Rotami FC', homeOdds: 2.10, drawOdds: 3.60, awayOdds: 3.20, marketsCount: 62, state: 'live' },
    { id: 'm7', league: 'Zona Premier', time: "58'", home: 'Teluka United', away: 'Brindavi City', homeOdds: 1.75, drawOdds: 3.80, awayOdds: 4.50, marketsCount: 61, state: 'live' },
    { id: 'm8', league: 'Vortex League', time: "63'", home: 'Mopeka Athletic', away: 'Zanfari Rovers', homeOdds: 2.30, drawOdds: 3.40, awayOdds: 2.90, marketsCount: 60, state: 'live' },
    { id: 'm9', league: 'Vortex League', time: "22'", home: 'Dukali SC', away: 'Porento Tigers', homeOdds: 1.95, drawOdds: 3.55, awayOdds: 3.65, marketsCount: 59, state: 'live' },
    { id: 'm10', league: 'Global Cup', time: "18:00", home: 'Wemari Wanderers', away: 'Tolaka FC', homeOdds: 3.20, drawOdds: 3.25, awayOdds: 2.10, marketsCount: 63, state: 'upcoming' },
    { id: 'm11', league: 'Global Cup', time: "18:00", home: 'Burani Stars', away: 'Loketa Warriors', homeOdds: 2.50, drawOdds: 3.30, awayOdds: 2.65, marketsCount: 61, state: 'upcoming' },
    { id: 'm12', league: 'African Championship', time: "18:30", home: 'Fentori United', away: 'Gabwela City', homeOdds: 1.88, drawOdds: 3.40, awayOdds: 4.10, marketsCount: 55, state: 'upcoming' },
    { id: 'm13', league: 'African Championship', time: "18:30", home: 'Zukabo Dynamo', away: 'Meranti Athletic', homeOdds: 2.15, drawOdds: 3.20, awayOdds: 3.35, marketsCount: 48, state: 'upcoming' },
    { id: 'm14', league: 'Super League', time: "19:00", home: 'Kombura City', away: 'Solino Rangers', homeOdds: 2.45, drawOdds: 3.10, awayOdds: 2.80, marketsCount: 52, state: 'upcoming' },
    { id: 'm15', league: 'Super League', time: "19:00", home: 'Veltrix Sporting', away: 'Balamo Stars', homeOdds: 1.68, drawOdds: 3.90, awayOdds: 4.80, marketsCount: 70, state: 'upcoming' },
    { id: 'm16', league: 'Copa Regional', time: "19:30", home: 'Rifoni Rovers', away: 'Kenzari FC', homeOdds: 2.05, drawOdds: 3.30, awayOdds: 3.45, marketsCount: 41, state: 'upcoming' },
    { id: 'm17', league: 'Copa Regional', time: "19:30", home: 'Orinoco United', away: 'Tampura City', homeOdds: 1.90, drawOdds: 3.50, awayOdds: 3.80, marketsCount: 44, state: 'upcoming' },
    { id: 'm18', league: 'Atlantic Shield', time: "20:00", home: 'Brampton Athletic', away: 'Varnam FC', homeOdds: 2.70, drawOdds: 3.15, awayOdds: 2.50, marketsCount: 66, state: 'upcoming' },
    { id: 'm19', league: 'Atlantic Shield', time: "20:00", home: 'Silverstone United', away: 'Dundalk Sporting', homeOdds: 1.80, drawOdds: 3.65, awayOdds: 4.20, marketsCount: 58, state: 'upcoming' },
    { id: 'm20', league: 'NORDIC League', time: "20:30", home: 'Boreal Star', away: 'Fjord Warriors', homeOdds: 2.25, drawOdds: 3.25, awayOdds: 3.05, marketsCount: 39, state: 'upcoming' },
    { id: 'm21', league: 'NORDIC League', time: "20:30", home: 'Helsinki Rovers', away: 'Oslo City', homeOdds: 1.92, drawOdds: 3.45, awayOdds: 3.75, marketsCount: 47, state: 'upcoming' },
    { id: 'm22', league: 'Pan-Asian Cup', time: "21:00", home: 'Sakura Dynamo', away: 'Dragon FC', homeOdds: 2.40, drawOdds: 3.20, awayOdds: 2.85, marketsCount: 53, state: 'upcoming' },
    { id: 'm23', league: 'Pan-Asian Cup', time: "21:00", home: 'Seoul United', away: 'Kyoto Athletic', homeOdds: 1.72, drawOdds: 3.80, awayOdds: 4.60, marketsCount: 60, state: 'upcoming' },
    { id: 'm24', league: 'Pacific Trophy', time: "21:30", home: 'Wellington City', away: 'Auckland Stars', homeOdds: 2.10, drawOdds: 3.35, awayOdds: 3.30, marketsCount: 36, state: 'upcoming' },
    { id: 'm25', league: 'Pacific Trophy', time: "21:30", home: 'Tasman FC', away: 'Coral Rovers', homeOdds: 2.60, drawOdds: 3.10, awayOdds: 2.65, marketsCount: 42, state: 'upcoming' },
    { id: 'm26', league: 'Eurasian League', time: "22:00", home: 'Volga Sporting', away: 'Ural United', homeOdds: 1.85, drawOdds: 3.50, awayOdds: 4.00, marketsCount: 50, state: 'upcoming' },
    { id: 'm27', league: 'Eurasian League', time: "22:00", home: 'Balkan Stars', away: 'Danube City', homeOdds: 2.30, drawOdds: 3.30, awayOdds: 2.95, marketsCount: 48, state: 'upcoming' },
    { id: 'm28', league: 'Sub-Saharan Premier', time: "22:30", home: 'Kigali Warriors', away: 'Mombasa FC', homeOdds: 2.00, drawOdds: 3.40, awayOdds: 3.50, marketsCount: 57, state: 'upcoming' },
    { id: 'm29', league: 'Sub-Saharan Premier', time: "22:30", home: 'Nairobi Dynamo', away: 'Kampala Athletic', homeOdds: 1.78, drawOdds: 3.70, awayOdds: 4.30, marketsCount: 64, state: 'upcoming' },
    { id: 'm30', league: 'Midnight Masters', time: "23:00", home: 'Starlight Rovers', away: 'Eclipse City', homeOdds: 2.15, drawOdds: 3.30, awayOdds: 3.25, marketsCount: 72, state: 'upcoming' }
  ]);

  readonly visibleMatches = computed(() => {
    const filter = this.activeFilter();
    return this.matchesList().filter(match => filter === 'all' || match.state === filter);
  });

  readonly combinedOdds = computed(() => Number(this.selections()
    .reduce((total, selection) => total * selection.odds, 1)
    .toFixed(2)));

  readonly potentialReturn = computed(() => Number((Math.max(0, this.stake || 0) * this.combinedOdds()).toFixed(2)));

  get isAuthenticated(): boolean { return this.auth.hasToken(); }

  ngOnInit(): void {
    this.subscriptions.push(
      this.auth.currentUser$.subscribe(user => this.currentUser.set(user)),
      this.auth.userBalance$.subscribe(balance => this.userBalance.set(balance))
    );

    this.oddsTickerTimer = setInterval(() => {
      this.matchesList.update(list =>
        list.map(match => {
          if (match.state === 'live') {
            const shift = (Math.random() - 0.5) * 0.14;
            const newHome = Math.max(1.05, Number((match.homeOdds + shift).toFixed(2)));
            const newDraw = Math.max(1.05, Number((match.drawOdds + (Math.random() - 0.5) * 0.10).toFixed(2)));
            const newAway = Math.max(1.05, Number((match.awayOdds + (Math.random() - 0.5) * 0.14).toFixed(2)));
            return { ...match, homeOdds: newHome, drawOdds: newDraw, awayOdds: newAway };
          }
          return match;
        })
      );
    }, 2500);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
    if (this.oddsTickerTimer) clearInterval(this.oddsTickerTimer);
  }

  setNavTab(tab: string): void {
    this.activeNavTab.set(tab);
    if (tab === 'aviator') {
      this.goToAviator();
    } else if (tab === 'live') {
      this.activeFilter.set('live');
    } else if (tab === 'home') {
      this.activeFilter.set('all');
    }
  }

  selectSport(sportId: string): void {
    this.selectedSport.set(sportId);
  }

  toggleMobileMenu(): void {
    this.showProfileMenu.set(false);
    this.mobileMenuOpen.update(open => !open);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  toggleProfileMenu(): void {
    this.showProfileMenu.update(value => !value);
  }

  openMyBetsModal(): void {
    this.showProfileMenu.set(false);
    this.closeMobileMenu();
    this.showMyBetsModal.set(true);
  }

  closeMyBetsModal(): void {
    this.showMyBetsModal.set(false);
  }

  openAccountModal(): void {
    this.showProfileMenu.set(false);
    this.closeMobileMenu();
    if (this.isAuthenticated) {
      this.showAccountModal.set(true);
    } else {
      this.goToLogin();
    }
  }

  closeAccountModal(): void {
    this.showAccountModal.set(false);
  }

  goToAviator(): void {
    this.closeMobileMenu();
    this.router.navigate(['/play']);
  }

  goToMyBets(): void {
    this.openMyBetsModal();
  }

  goToAccount(): void {
    this.openAccountModal();
  }

  goToWallet(): void {
    this.showProfileMenu.set(false);
    this.closeMobileMenu();
    localStorage.setItem('walletReturnUrl', '/bets');
    this.router.navigate(['/wallet'], { state: { returnUrl: '/bets' } });
  }

  openDeposit(): void {
    this.showProfileMenu.set(false);
    this.closeMobileMenu();
    localStorage.setItem('walletReturnUrl', '/bets');
    this.router.navigate(['/deposit'], { state: { returnUrl: '/bets' } });
  }

  toggleSelection(match: FootballMatch, outcome: 'home' | 'draw' | 'away'): void {
    if (!this.isAuthenticated) { this.goToLogin(); return; }
    const outcomeLabel = outcome === 'home' ? match.home : outcome === 'draw' ? 'Draw' : match.away;
    const odds = outcome === 'home' ? match.homeOdds : outcome === 'draw' ? match.drawOdds : match.awayOdds;

    this.selections.update(items => {
      const exists = items.some(item => item.matchId === match.id && item.outcome === outcome);
      if (exists) {
        return items.filter(item => !(item.matchId === match.id && item.outcome === outcome));
      }
      return [
        ...items.filter(item => item.matchId !== match.id),
        { matchId: match.id, matchLabel: `${match.home} v ${match.away}`, outcome, outcomeLabel, odds }
      ];
    });
  }

  isSelected(matchId: string, outcome: 'home' | 'draw' | 'away'): boolean {
    return this.selections().some(item => item.matchId === matchId && item.outcome === outcome);
  }

  removeSelection(selection: BetSlipSelection): void {
    this.selections.update(items => items.filter(item => item !== selection));
  }

  clearSlip(): void {
    this.selections.set([]);
  }

  loadBetslipByCode(): void {
    if (!this.betslipCode.trim()) return;
    const matches = this.matchesList();
    if (matches.length > 0) {
      this.toggleSelection(matches[0], 'home');
      this.betslipCode = '';
    }
  }

  placeDemoBet(): void {
    if (this.userBalance() > MAX_PLAY_BALANCE) {
      alert(PLAY_LIMIT_MESSAGE);
      return;
    }
    if (!this.selections().length) return;
    alert(`Bet placed! Total odds: ${this.combinedOdds()}`);
    this.selections.set([]);
  }

  goToLogin(): void { this.router.navigate(['/login']); }
  goToRegister(): void { this.router.navigate(['/login'], { queryParams: { mode: 'register' } }); }
  logout(): void {
    this.closeMobileMenu();
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
