const artwork = '/assets/dashboard';
const icon = (name: string) => `${artwork}/icons/${name}.svg`;
const aviator = { id: 'aviator', name: 'Aviator', image: `${artwork}/aviator.png` };

interface DashboardTile {
  id: string;
  name: string;
  image: string;
  brandTitle?: string;
}

export const dashboardBanners = [
  { id: 'kings-move', title: 'King’s Move', image: `${artwork}/banner-kings-move.jpg` },
  { id: 'aviator', title: 'Play Aviator', image: `${artwork}/banner-aviator.jpg` },
  { id: 'sports', title: 'Explore demo matches', image: `${artwork}/banner-football.jpg` },
  { id: 'wallet', title: 'Betzion Wallet', image: `${artwork}/banner-wallet.jpg` },
];

export const primaryNav = [
  { id: 'sports', label: 'Sports Betting' },
  { id: 'live', label: 'Live Betting' },
  { id: 'league', label: 'Betzion League' },
  { id: 'casino', label: 'Casino' },
  { id: 'poly', label: 'Prediction Market' },
  { id: 'jackpots', label: 'Jackpots' },
  { id: 'livescore', label: 'Livescore' },
  { id: 'promos', label: 'Promotions' },
];

export const navRail = [
  { id: 'home', label: 'Home', icon: icon('home') },
  { id: 'live', label: 'Live', icon: icon('live') },
  { id: 'soccer', label: 'Soccer', icon: icon('soccer') },
  { id: 'league', label: 'League', icon: icon('league') },
  { id: 'aviator', label: 'Aviator', icon: aviator.image },
  { id: 'poly', label: 'Poly', icon: icon('poly') },
  { id: 'virtuals', label: 'Virtuals', icon: icon('virtuals') },
  { id: 'games', label: 'Games', icon: icon('games') },
  { id: 'crash', label: 'Crash', icon: icon('crash') },
  { id: 'casino', label: 'Casino', icon: icon('casino') },
  { id: 'promos', label: 'Promos', icon: icon('promos') },
  { id: 'nare', label: 'Nare', icon: icon('nare') },
  { id: 'evolution', label: 'Evolution', icon: icon('evolution') },
  { id: 'turbo', label: 'Turbo', icon: icon('turbo') },
  { id: 'slots', label: 'Slots', icon: icon('slots') },
  { id: 'esoccer', label: 'eSoccer', icon: icon('esoccer') },
  { id: 'basketball', label: 'Basketball', icon: icon('basketball') },
];

const comet = { id: 'comet-crash', name: 'Comet Crash', image: `${artwork}/comet-crash.jpg` };
const jetx = { id: 'jetx', name: 'JetX', image: `${artwork}/jetx.jpg` };

export const sideTiles: DashboardTile[] = [
  { id: 'instant-virtuals', name: 'Instant Virtuals', image: `${artwork}/instant-virtuals.jpg` },
  aviator,
  { id: 'aviatrix', name: 'Aviatrix', image: `${artwork}/aviatrix.jpg` },
  comet,
  { id: 'nare', name: 'Betzion Nare', image: icon('nare'), brandTitle: 'Nare' },
  jetx,
];

export const gameTiles: DashboardTile[] = [
  aviator,
  { id: 'hero', name: 'Betzion Hero', image: `${artwork}/betzion-hero.jpg`, brandTitle: 'Hero' },
  { id: 'kings-move', name: 'King’s Move', image: `${artwork}/kings-move.jpg` },
  jetx,
  { id: 'flight', name: 'Betzion Flight', image: `${artwork}/betzion-flight.jpg`, brandTitle: 'Flight' },
  comet,
];

export const gameTabs = [
  { id: 'crash', label: 'Crash', flame: true },
  { id: 'betbuilder', label: 'BetBuilder', flame: false },
  { id: 'league', label: 'Betzion League', flame: false },
  { id: 'poly', label: 'Betzion Poly', flame: false },
];

export const gameCategories = [
  { id: 'crash', label: 'Crash', count: 6 },
  { id: 'slots', label: 'Slots' },
  { id: 'exclusive', label: 'Betzion Exclusive', count: 2 },
  { id: 'virtuals', label: 'Virtuals' },
  { id: 'wheel', label: 'Wheel Games' },
  { id: 'dice', label: 'Dice' },
  { id: 'high-stakes', label: 'High Stakes' },
];

export const topLeagues = [
  { name: 'UEFA Champions League', region: 'Internationals', count: 18 },
  { name: 'UEFA Europa League', region: 'Internationals', count: 18 },
  { name: 'Premier League', region: 'England', count: 20 },
  { name: 'LaLiga', region: 'Spain Amateur', count: 21 },
  { name: 'EFL Cup', region: 'England', count: 16 },
  { name: 'Serie A', region: 'Italy', count: 20 },
];

export const quickLinks = [
  { id: 'live', label: 'Live Inplay', count: 68, icon: icon('live') },
  { id: 'soccer', label: 'Soccer', count: 179, icon: icon('soccer') },
  { id: 'premier', label: 'Premier League', count: 20, icon: icon('league') },
  { id: 'laliga', label: 'LaLiga', count: 21, icon: icon('league') },
  { id: 'seriea', label: 'Serie A', count: 20, icon: icon('league') },
  { id: 'esoccer', label: 'eSoccer', count: 28, icon: icon('esoccer') },
];
