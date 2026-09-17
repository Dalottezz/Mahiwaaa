const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
require('dotenv').config();
const mongodb = require('./mongodb');
const archpay = require('./archpay');

function parseAllowedOrigins(value) {
  const raw = (value || 'http://localhost:4200').trim();
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
// These are the public frontend domains for this service. Keep them available
// even if a Render environment variable is incomplete, otherwise a deployment
// can accept registration locally yet reject browser API calls in production.
const REQUIRED_PUBLIC_ORIGINS = new Set([
  'https://betzion.site',
  'https://www.betzion.site',
]);

// Automatically trust the Replit production + dev domains assigned to this
// deployment (REPLIT_DOMAINS may be a comma-separated list).
const REPLIT_DOMAIN_ORIGINS = (process.env.REPLIT_DOMAINS || '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => `https://${d}`);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (REQUIRED_PUBLIC_ORIGINS.has(origin)) return true;
  if (REPLIT_DOMAIN_ORIGINS.includes(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

const PORT = process.env.PORT || 3022;
const JWT_SECRET = process.env.JWT_SECRET || 'aviator_local_secret_key_2026';
const FIRST_DEPOSIT_REQUIRED_MESSAGE = 'A funded game balance is required before placing bets.';
const NEW_MEMBER_BONUS_AMOUNT = 1999;
const MIN_DEPOSIT_AMOUNT = Math.max(1, Number(process.env.MIN_DEPOSIT_AMOUNT) || 999);
// Hard ceiling on a single deposit. Unlike the minimum, this is deliberately
// not an admin-editable game setting: no deposit may exceed it, whatever the
// quick-amount buttons on the deposit tabs offer.
const MAX_DEPOSIT_AMOUNT = Math.max(1, Number(process.env.MAX_DEPOSIT_AMOUNT) || 1999);
const CHAT_MINIMUM_BALANCE = 1000;
const CHAT_HISTORY_LIMIT = 120;
const ENABLE_RUNTIME_LOGS = (process.env.ENABLE_RUNTIME_LOGS || 'false').toLowerCase() === 'true';
const ARCHPAY_CALLBACK_TOKEN = process.env.ARCHPAY_CALLBACK_TOKEN || '';
// ArchPay's own API does not document a fixed STK expiry: their
// transaction-status endpoint has a QUEUED state explicitly meaning
// "still waiting on the callback" rather than a failure. A short client-side
// cutoff force-fails genuinely successful payments whenever the customer is
// a little slow entering their M-Pesa PIN or ArchPay's callback lags the
// Safaricom confirmation. 150s gives that real-world slack room while still
// resolving stuck prompts in a reasonable time.
const ARCHPAY_PENDING_PAYMENT_EXPIRY_MS = Math.max(
  30_000,
  Number(process.env.ARCHPAY_PENDING_PAYMENT_EXPIRY_MS) || 150_000
);
const ARCHPAY_STATUS_CHECK_INTERVAL_MS = 2_000;
const ARCHPAY_THROTTLE_COOLDOWN_MS = 60_000;
// After we give up waiting and show the player "failed", ArchPay may still
// deliver a genuine confirmation late (webhook delay, slow PIN entry near
// the edge of the window, etc). Keep listening at a low frequency for a
// while longer so a real payment is never silently lost — only an explicit
// FAILED result from ArchPay is ever treated as permanently terminal.
// Confirmed against ArchPay's live transaction-status API during testing:
// a queued STK push can sit unresolved on their side for 10+ minutes with
// no callback and no definitive status, so the grace window needs real
// headroom rather than a couple of extra minutes.
const ARCHPAY_LATE_CONFIRMATION_WINDOW_MS = Math.max(
  0,
  Number(process.env.ARCHPAY_LATE_CONFIRMATION_WINDOW_MS) || 30 * 60_000
);
const ARCHPAY_LATE_CONFIRMATION_INTERVAL_MS = 15_000;

// Tag written on every new M-Pesa STK deposit. Deposits created before the
// ArchPay migration are stored under PayHero's tag; they are the same kind of
// transaction handled by the same flow, so every lookup accepts either while
// only new rows get the ArchPay tag. Dropping the legacy value here would hide
// historical deposits from the admin views and the restart recovery sweep.
const MPESA_DEPOSIT_METHOD = 'archpay_mpesa';
const MPESA_DEPOSIT_METHODS = new Set([MPESA_DEPOSIT_METHOD, 'payhero_mpesa']);

function isMpesaDeposit(tx) {
  return Boolean(tx) && tx.type === 'deposit' && MPESA_DEPOSIT_METHODS.has(tx.paymentMethod);
}

// ArchPay prints accountReference on the customer's M-Pesa statement and caps
// it at 12 characters, so the reference is generated compactly enough to
// survive the round trip intact and still be matched when the webhook echoes
// it back. Base-36 time plus a random suffix keeps it unique and short.
function generateDepositReference() {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = Math.floor(Math.random() * 36).toString(36).toUpperCase();
  return `AVT${stamp}${suffix}`.slice(0, archpay.ACCOUNT_REFERENCE_MAX_LENGTH);
}

const chatMessages = [];
let chatMessageSequence = 0;
let chatOnlineCount = 8130;
const CHAT_AVATARS = ['pilot', 'wolf', 'vulture', 'strawberry', 'soldier', 'lips', 'lion', 'leaf', 'jet', 'girl'];
const CHAT_BOT_NAMES = [
  '2***5', '2***1', '2***7', '2***4', '2***9', '2***3', '2***8', '2***6', '2***2', '2***0',
  '071***28', '072***91', '079***45', '070***63', '074***19', '075***82', '076***34', '078***50',
  '2547***12', '2547***99', '2547***34', '2547***88', '2547***56', '2547***71', '2547***03',
  'd***n', 'k***o', 'm***a', 'j***2', 'w***4', 'b***9', 'e***7', 'p***1', 'v***x', 's***8',
  'r***5', 'c***0', 'g***3', 't***6', 'h***8', 'l***2', 'n***9', 'y***4', 'a***1', 'f***7'
];

const CHAT_BOT_MESSAGES = [
  'Betzion inalipa mbaya sana leo! Nishatoa 45k kwa M-Pesa 🤑',
  'Wazi bro, signals za leo zilikua on point sana, asante Mr Dan 🙏',
  'Nani ako Room 1 sai? Nimeona 18.5x ikitokea plane imepaa safi 🚀',
  'Aki signals ziko legit, nimeanza na 500 nikatoa 14,000!',
  'Deposit ya M-Pesa imeingia instant bila delay yoyote.',
  'Kijana tulia usitoke mapema, target 3x hadi 5x ndio safe.',
  'Naitwa Rose thank you so much Mr Dan nmetoa kwa 50K leo ubarikiwe sana!',
  'Eii plane imeenda 54x! Nani alishika hii round ya moto?',
  'Signals za leo zimecome through fiti sana, niko happy.',
  'Hapa Betzion hakuna delay kwa payout, 2 mins pesa iko kwa M-Pesa 🙌',
  'Tuliza boli cheza na discipline usifuate emotions wakuu.',
  'Room 3 iko moto leo, continuous purple rounds 🔥',
  'Nani ako na stake ya 1000 twende kazi kwa Room 1?',
  'Wakuu cashout at 2.50x ndio safe zone, usikue greedy.',
  'Betzion best platform Kenya hands down 💯',
  'Nimeangukia 12k with stake ndogo ya 300, signal ilisema 4x.',
  'Withdrawal ya 35,000 imeingia chap chap kwa M-Pesa!',
  'Mungu akubariki Mr Dan kwa signals safi sana mtafute ni legit.',
  'Leo ndio ile siku ya kuomoka na Betzion mabro.',
  'Room 1 prediction ilikua accurate 100% leo.',
  'Niko live hapa naona purple odds zikipanda tu.',
  'Leo round 10 zote zimepita 3x, hii ni baraka tupu.',
  'Signal ya saa nane imelipa fiti sana, nimerecover capital.',
  'Chezeni smart wakuu, aviator inataka patience na hesabu.',
  'Betzion engine iko smooth sana, hakuna lagging hata kidogo.',
  'Nimecatch 9.40x kwa Room 2, leo weekend imejipa mapema 💰',
  'Discipline ndio siri hapa, 2x kila round inatosha kabisa.',
  'Wadau signals za telegram ziko accurate leo, nimetoa 28k.',
  'Withdrawal yangu ya 15k imeingia instant bila stress.',
  'Room 2 inapeana ma odds kali sana, check history uone.',
  'Kila mtu anacheza Betzion anajua hapa hakuna delay ya cashout.',
  'Signals zimenisaidia kuelewa graph vizuri sana.',
  'Nimecashout kwa 4.50x nikaacha watu wakilia kwa crash.',
  'Small stakes with high frequency ndio format yangu ya leo.',
  'Betzion mko juu, engine ya spribe iko on point.',
  'Nimepiga 8k na stake ya 200 tu, asante Mr Dan!',
  'Guys remember to set auto cashout at 2.0x to protect your balance.',
  'Nani ako na tips za Room 3? Leo naona inatoa high multipliers.',
  'Kuingia na balance poa ndio unacheza bila pressure.',
  'Mimi niko disciplined, target yangu ya 20k per day nimehit tayari.',
  'Betzion payout speed is unmatched, seconds tu kwa simu.',
  'Bro signals za leo ziko fire 🔥🔥🔥',
  'Nimepata 6.80x kwa first bet ya leo, blessed day!',
  'Always withdraw your profits first, kisha cheza na faida.',
  'Betzion ndio kusema, games zote ziko provably fair.',
  'Mr Dan signals are top tier, amerecover lost funds zote.',
  'Leo niko locked in, signals zikidrop tu naweka stake.',
  'Room 1 imepanda 33x sasa hivi, what a massive flight!',
  'Cashout early, secure the bag, rinse and repeat.',
  'Nimejaribu split betting kwa panel 1 na panel 2, method inawork fiti.',
  'Betzion customer service pia wako fast sana.',
  'Leo niko 4 wins in a row, thanks to the live signals.',
  'Hata na stake ndogo unaeza build balance pole pole.',
  'Nani mwingine amewithdraw leo? Mpesa yangu inasoma safi.',
  'Signals ziko accurate 90%+ hii wiki nzima.',
  'Discipline over emotions always, aviator rules.',
  'Plane imepaa tena 12x, Room 1 is cooking today!',
  'Nimepata 5k with just 250 bob, Betzion is the real deal.',
  'Wakuu chezeni na plan, don’t gamble blindly.',
  'Mr Dan thank you bro, 40k profit in one afternoon!',
  'Betzion room switching is so seamless, nimeona 15x kwa Room 2!',
  'Kaa rada na signal ya 4:30pm inakam na multiplier nzito.',
  'Mimi leo sitoki kwa game hadi nihit 50k target.',
  'Nimecash out 5.20x nikamake 10,400 with 2k stake.',
  'Watu wa Betzion mko safe kabisa, hakuna delayed withdrawals.',
  'Respect the graph, check pink history kabla uweke heavy stake.',
  '24x caught safely! Mpesa alert ting ting 📲',
  'Chezeni na 2.0x auto cashout wakuu, consistency ndio key.',
  'Nani mwingine ako Room 2? Grafu inasoma fiti sana.',
  'Hii round imeenda 78x eish! Nani alibaki ndani?',
  'Nashukuru sana Mr Dan, nimelipa rent ya mwezi na aviator leo 🙏',
  'Deposit ya 2k imekua 26,400 in 30 mins!',
  'Wakuu never chase losses, take a break ukihit target.',
  'Signals za VIP channel ziko 98% win rate leo.',
  'Hapa Betzion hakuna delay ya ku-credit winnings.',
  'Plane imepaa tena! Room 1 inafanya mambo leo ✈️🔥',
  'Nimepata 16.50x na stake ya 500, day made!',
  'Leo ni mwendo wa green tu kwa history yangu.',
  'Follow the signals carefully usiruke round.',
  'M-Pesa balance inasoma vizuri sana baada ya hii session 💰',
  'Nimeeka auto cashout 3.5x imegonga pap!',
  'Watu wa 100 bob msiogope, pole pole ndio mwendo.',
  'Kila mtu anacheza smart leo, continuous wins!',
  'Room 3 has given 3 pinks in the last 10 minutes 🔥',
  'Hii game iko smooth kuliko platforms zingine zote Kenya.',
  'Signals za Mr Dan ndio zimeniokoa baada ya bad run.',
  'Withdrawal processing in 60 seconds flat, incredible 🙌',
  'Nimefika 50k milestone ya leo, sasa naenda zangu.',
  'Always set a daily stop-loss and profit target.',
  'Pink rounds zimejaa kwa table, game is on fire!',
  'Leo niko 7 out of 8 wins, pure discipline.',
  'Betzion is the real king of crash games in KE 👑',
  'Nani ako ready na next signal? Dropping in 2 mins!',
  'Target hit! 10k profit locked and withdrawn 💸',
  'Aviator with fast payout is unmatched.',
  'Patience pays here wakuu, don’t rush every round.',
  'Room 1 taking off again, 10x guaranteed soon!',
  'Nimecashout 4.2x with panel 1 and 8.0x with panel 2!',
  'Split betting strategy is working wonders today 🔥',
  'Signal checked, bet placed, win secured 🚀',
  'Hapa hakuna story ya pending withdrawals, instant payout.',
  'Nimeona 42x ikipaa, what a massive multiplier!',
  'Tukutane VIP session ya jioni wakuu 💪',
  'Respect the signals and manage your bankroll.',
  'Another 15,000 KES straight to my M-Pesa account!',
  'Betzion to the moon 🚀🚀🚀'
];

function runtimeLog(...args) {
  if (ENABLE_RUNTIME_LOGS) console.log(...args);
}

function maskChatUsername(value) {
  const username = String(value || 'Player').trim() || 'Player';
  if (username.includes('***')) return username;
  if (username.length <= 2) return `${username[0] || 'P'}***`;
  return `${username.slice(0, Math.min(2, username.length - 1))}***${username.slice(-1)}`;
}

function createChatMessage({ username, text, userId = null, isBot = false, timestamp = Date.now(), avatarIndex = chatMessageSequence }) {
  chatMessageSequence += 1;
  const avatar = CHAT_AVATARS[Math.abs(Number(avatarIndex) || 0) % CHAT_AVATARS.length];
  return {
    id: `chat-${Date.now()}-${chatMessageSequence}`,
    username: maskChatUsername(username),
    text: String(text || '').trim().slice(0, 220),
    timestamp: new Date(timestamp).toISOString(),
    avatar: `assets/avatars/avatar-${avatar}.svg`,
    likes: isBot ? Math.floor(Math.random() * 6) + 1 : 0,
    isBot,
    userId,
  };
}

function getChatAccess(socket) {
  const balance = socket?.odlutUserId ? Number(getWalletRecord(socket.odlutUserId)?.balance || 0) : 0;
  return {
    allowed: Number.isFinite(balance) && balance >= CHAT_MINIMUM_BALANCE,
    balance: Number.isFinite(balance) ? balance : 0,
    minimumBalance: CHAT_MINIMUM_BALANCE,
  };
}

function broadcastChatMessage(message) {
  io.emit('chat:message', message);
}

function appendChatMessage(message, broadcast = true) {
  if (!message?.text) return;
  chatMessages.push(message);
  if (chatMessages.length > CHAT_HISTORY_LIMIT) chatMessages.splice(0, chatMessages.length - CHAT_HISTORY_LIMIT);
  if (broadcast) broadcastChatMessage(message);
}

function emitChatSnapshot(socket) {
  socket.emit('chat:access', getChatAccess(socket));
  socket.emit('chat:online', { count: chatOnlineCount });
  socket.emit('chat:history', chatMessages);
}

function broadcastChatOnline() {
  let connectedPlayers = 0;
  io.sockets.sockets.forEach((client) => {
    if (client.odlutUserId) connectedPlayers += 1;
  });
  const displayedCount = chatOnlineCount + connectedPlayers;
  io.emit('chat:online', { count: displayedCount });
}

function seedChatMessages() {
  const now = Date.now();
  const sampleCount = 35;
  for (let i = 0; i < sampleCount; i++) {
    const textIndex = i % CHAT_BOT_MESSAGES.length;
    const nameIndex = i % CHAT_BOT_NAMES.length;
    appendChatMessage(createChatMessage({
      username: CHAT_BOT_NAMES[nameIndex],
      text: CHAT_BOT_MESSAGES[textIndex],
      isBot: true,
      timestamp: now - ((sampleCount - i) * 6_500),
      avatarIndex: i,
    }), false);
  }
}

function scheduleChatBotMessage() {
  const delay = 900 + Math.floor(Math.random() * 1500);
  const timer = setTimeout(() => {
    const textIndex = Math.floor(Math.random() * CHAT_BOT_MESSAGES.length);
    const nameIndex = Math.floor(Math.random() * CHAT_BOT_NAMES.length);
    appendChatMessage(createChatMessage({
      username: CHAT_BOT_NAMES[nameIndex],
      text: CHAT_BOT_MESSAGES[textIndex],
      isBot: true,
      avatarIndex: chatMessageSequence,
    }));
    broadcastChatOnline();
    scheduleChatBotMessage();
  }, delay);
  timer.unref?.();
}

seedChatMessages();
scheduleChatBotMessage();
const chatOnlineTimer = setInterval(() => {
  const drift = Math.floor(Math.random() * 31) - 15;
  chatOnlineCount = Math.max(7_800, Math.min(9_200, chatOnlineCount + drift));
  broadcastChatOnline();
}, 4_500);
chatOnlineTimer.unref?.();

app.use(cors(corsOptions));
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Aviator Backend</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>body{margin:0;font-family:Arial,sans-serif;background:#020617;color:#fff;text-align:center;padding:40px}img{max-width:140px;margin-bottom:24px}a{color:#7c3aed;text-decoration:none}</style>
      </head>
      <body>
        <h1>Aviator Backend</h1>
        <p>This is the Aviator backend service. Use the API endpoints under <code>/api/*</code>.</p>
        <p><a href="/api/health">Health check</a></p>
      </body>
    </html>
  `);
});

app.use((req, res, next) => {
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════════════════════════

const users = new Map();
const wallets = new Map();
const transactions = [];
// Predator access tokens. An administrator generates one, hands the code to a
// player, and the player redeems it to unlock the crash signals for a fixed
// window. The token record is the single source of truth for a subscription:
// who holds it and when it lapses, so revoking the token revokes the access.
let predatorTokens = [];
// The predictor catalogue. Betzion ships as a built-in entry; further sites are
// added by an administrator, who also sets each price and whether it is on sale
// yet. A site that is not available is advertised but cannot be bought.
let predatorSites = [];
// Subscriptions bought with wallet balance, kept apart from the token ledger so
// an issued code and a paid purchase can both grant the same access.
let predatorSubscriptions = [];
let siteSettings = {};
let storeWriteQueue = Promise.resolve();
let canonicalRestoreState = null;
const paymentStatusQueries = new Map();

function getPersistenceAdapter() {
  return mongodb;
}

function seedDefaultUsers() {
  const seedPhone = normalizePhone(process.env.SEED_ADMIN_PHONE) || '254712345678';
  const seedPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123456';
  const seedHash = bcrypt.hashSync(seedPassword, 10);
  const fantasticHash = bcrypt.hashSync('Fantastic@456', 10);

  const initialSeedUsers = [
    {
      id: `superadmin-${seedPhone}`,
      username: process.env.SEED_ADMIN_USERNAME || 'Administrator',
      email: process.env.SEED_ADMIN_EMAIL || `admin-${seedPhone}@example.invalid`,
      phone: seedPhone,
      passwordHash: seedHash,
      role: 'SUPER_ADMIN',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'admin-254711111111',
      username: 'Administrator',
      email: 'admin@betzion.site',
      phone: '254711111111',
      passwordHash: fantasticHash,
      role: 'ADMIN',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'admin-25471111111',
      username: 'Administrator',
      email: 'admin-short@betzion.site',
      phone: '25471111111',
      passwordHash: fantasticHash,
      role: 'ADMIN',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'admin-254792011285',
      username: 'Administrator',
      email: 'oreagan938@gmail.com',
      phone: '254792011285',
      passwordHash: fantasticHash,
      role: 'ADMIN',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ];

  for (const u of initialSeedUsers) {
    if (!users.has(u.id)) {
      users.set(u.id, u);
      wallets.set(u.id, normalizeWallet({ balance: '0.00', depositCount: 0 }));
    }
  }
}

// LOCAL_DATA_DIR lets real-payment tests use disposable local storage instead
// of a configured production database or the repository's normal snapshots.
const DATA_DIR = process.env.LOCAL_DATA_DIR
  ? path.resolve(process.env.LOCAL_DATA_DIR)
  : path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const RESTORE_SNAPSHOT_FILE = path.join(DATA_DIR, 'restore-snapshot.json');
let storeMtimeMs = 0;

function ensureStoreDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveLocalSnapshot() {
  ensureStoreDir();
  const payload = JSON.stringify({
    users: Array.from(users.values()),
    wallets: Array.from(wallets.entries()),
    transactions,
    gameSettings,
    withdrawalPopupSettings,
    predatorTokens,
    predatorSites,
    predatorSubscriptions,
  }, null, 2);
  // The copied backend remains usable without MongoDB during local work. Keep
  // both local restoration sources current so admin edits survive a restart.
  fs.writeFileSync(STORE_FILE, payload);
  fs.writeFileSync(RESTORE_SNAPSHOT_FILE, payload);
}

function saveStore() {
  try {
    saveLocalSnapshot();
  } catch (error) {
    console.error('Failed to save local state:', error?.message || error);
  }
  storeWriteQueue = storeWriteQueue
    .then(() => Promise.all([
      mongodb.saveState(users, wallets),
      mongodb.saveTransactions(transactions),
    ]))
    .catch((err) => console.error('Failed to save DB state:', err.message));
  return storeWriteQueue;
}

/**
 * Predator tokens from the on-disk snapshot, for runs without MongoDB. Read
 * before the database copy so an operator working locally still sees the
 * subscriptions they issued.
 */
function loadLocalPredatorTokens() {
  try {
    const candidateFiles = [RESTORE_SNAPSHOT_FILE, STORE_FILE].filter((filePath) => fs.existsSync(filePath));
    for (const filePath of candidateFiles) {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
      if (Array.isArray(saved?.predatorTokens)) return saved.predatorTokens;
    }
  } catch (error) {
    console.warn('Failed to load locally saved Predator tokens:', error?.message || error);
  }
  return null;
}

/** Catalogue and paid subscriptions from the on-disk snapshot. */
function loadLocalPredatorState() {
  try {
    const candidateFiles = [RESTORE_SNAPSHOT_FILE, STORE_FILE].filter((filePath) => fs.existsSync(filePath));
    for (const filePath of candidateFiles) {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
      if (Array.isArray(saved?.predatorSites) || Array.isArray(saved?.predatorSubscriptions)) {
        return {
          sites: Array.isArray(saved.predatorSites) ? saved.predatorSites : null,
          subscriptions: Array.isArray(saved.predatorSubscriptions) ? saved.predatorSubscriptions : null,
        };
      }
    }
  } catch (error) {
    console.warn('Failed to load locally saved Predator catalogue:', error?.message || error);
  }
  return { sites: null, subscriptions: null };
}

function loadLocalGameSettings() {
  try {
    const candidateFiles = [RESTORE_SNAPSHOT_FILE, STORE_FILE].filter((filePath) => fs.existsSync(filePath));
    for (const filePath of candidateFiles) {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
      if (saved?.gameSettings && typeof saved.gameSettings === 'object') return saved.gameSettings;
    }
  } catch (error) {
    console.warn('Failed to load locally saved game settings:', error?.message || error);
  }
  return null;
}

function loadLocalTransactions() {
  try {
    const candidateFiles = [RESTORE_SNAPSHOT_FILE, STORE_FILE].filter((filePath) => fs.existsSync(filePath));
    for (const filePath of candidateFiles) {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
      if (Array.isArray(saved?.transactions)) return saved.transactions;
    }
  } catch (error) {
    console.warn('Failed to load locally saved transactions:', error?.message || error);
  }
  return [];
}

function loadStore(force = false) {
  // Loading from MongoDB happens in bootstrapPersistence, not here
  // This function is kept for backwards compatibility but does nothing
  return true;
}

function loadCanonicalRestoreState() {
  if (canonicalRestoreState) return canonicalRestoreState;

  try {
    const candidateFiles = [RESTORE_SNAPSHOT_FILE, STORE_FILE].filter((filePath) => fs.existsSync(filePath));
    let bestCandidate = null;

    for (const filePath of candidateFiles) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw || '{}');
      const seedUsers = new Map();
      const seedWallets = new Map();

      for (const user of data.users || []) {
        const key = user?.id || user?.email;
        if (key) seedUsers.set(key, user);
      }

      for (const entry of data.wallets || []) {
        if (Array.isArray(entry) && entry.length === 2 && entry[0]) {
          seedWallets.set(entry[0], normalizeWallet(entry[1]));
        }
      }

      const candidate = { users: seedUsers, wallets: seedWallets, score: seedUsers.size + seedWallets.size };
      if (candidate.score > 0 && (!bestCandidate || candidate.score > bestCandidate.score)) {
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      canonicalRestoreState = {
        users: bestCandidate.users,
        wallets: bestCandidate.wallets,
      };
      return canonicalRestoreState;
    }
  } catch (err) {
    console.warn('Failed to read local restore snapshot:', err?.message || err);
  }

  const fallbackUsers = new Map();
  const fallbackWallets = new Map();

  defaultUsers.forEach((u) => {
    fallbackUsers.set(u.id, {
      id: u.id,
      username: u.username,
      fullName: u.username,
      email: u.email,
      phone: u.phone,
      passwordHash: bcrypt.hashSync(u.password, 10),
      role: u.role,
      isActive: true,
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    fallbackWallets.set(u.id, normalizeWallet({ balance: u.balance.toFixed(2), depositCount: 1 }));
  });

  canonicalRestoreState = { users: fallbackUsers, wallets: fallbackWallets };
  return canonicalRestoreState;
}

function mergeRestoreState(sourceState = {}) {
  const canonical = loadCanonicalRestoreState();
  const sourceUsers = new Map();
  const sourceWallets = new Map();

  for (const user of sourceState.users || []) {
    const key = user?.id || user?.email;
    if (key) sourceUsers.set(key, user);
  }

  for (const entry of sourceState.wallets || []) {
    if (Array.isArray(entry) && entry.length === 2 && entry[0]) {
      sourceWallets.set(entry[0], normalizeWallet(entry[1]));
    }
  }

  const mergedUsers = new Map(sourceUsers);
  const mergedWallets = new Map(sourceWallets);
  let changed = false;

  for (const [seedKey, seedUser] of canonical.users.entries()) {
    const liveEntry = Array.from(mergedUsers.entries()).find(([, user]) => {
      const sameId = user?.id && user.id === seedUser.id;
      const sameEmail = (user?.email || '').toLowerCase() === (seedUser.email || '').toLowerCase();
      const samePhone = normalizePhone(user?.phone) && normalizePhone(user?.phone) === normalizePhone(seedUser.phone);
      return sameId || sameEmail || samePhone;
    });

    if (!liveEntry) {
      mergedUsers.set(seedUser.id || seedKey, { ...seedUser });
      changed = true;
    } else {
      const [liveKey, liveUser] = liveEntry;
      const restoredUser = {
        ...liveUser,
        ...seedUser,
        id: seedUser.id || liveUser.id || liveKey,
        fullName: seedUser.fullName || seedUser.username || liveUser.fullName || liveUser.username || null,
        username: seedUser.username || liveUser.username || null,
        email: seedUser.email || liveUser.email || null,
        phone: seedUser.phone || liveUser.phone || null,
        passwordHash: liveUser.passwordHash || seedUser.passwordHash,
      };

      mergedUsers.delete(liveKey);
      mergedUsers.set(restoredUser.id, restoredUser);

      if (
        liveUser.passwordHash !== restoredUser.passwordHash ||
        liveUser.role !== restoredUser.role ||
        liveUser.email !== restoredUser.email ||
        liveUser.phone !== restoredUser.phone ||
        liveUser.username !== restoredUser.username ||
        liveUser.isActive !== restoredUser.isActive
      ) {
        changed = true;
      }
    }

    const seedWallet = normalizeWallet(canonical.wallets.get(seedKey) || { balance: '0.00', depositCount: 0 });
    const liveWallet = mergedWallets.get(seedKey);
    if (!liveWallet || liveWallet.balance !== seedWallet.balance || liveWallet.depositCount !== seedWallet.depositCount) {
      changed = true;
    }
    mergedWallets.set(seedKey, seedWallet);
  }

  return { users: mergedUsers, wallets: mergedWallets, changed };
}

async function applyRestoreSnapshot(options = {}) {
  const { sourceState, persist = true } = options;
  let resolvedSource = sourceState;

  if (!resolvedSource) {
    resolvedSource = {
      users: Array.from(users.values()),
      wallets: Array.from(wallets.entries()),
    };

    try {
      const mongoState = await mongodb.loadState();
      if (mongoState) resolvedSource = mongoState;
    } catch (error) {
      console.warn('DB read failed during restore; using current snapshot instead:', error?.message || error);
    }
  }

  const merged = mergeRestoreState(resolvedSource || {});

  users.clear();
  wallets.clear();

  for (const user of merged.users.values()) {
    const key = user?.id || user?.email;
    if (key) users.set(key, user);
  }

  for (const [walletId, wallet] of merged.wallets.entries()) {
    wallets.set(walletId, normalizeWallet(wallet));
  }

  if (persist) {
    try {
      await mongodb.saveState(users, wallets);
    } catch (error) {
      console.warn('Persisting restore snapshot to DB failed, but in-memory state was updated:', error?.message || error);
    }
  }

  return {
    changed: merged.changed,
    users: users.size,
    wallets: wallets.size,
    mode: 'mongodb',
  };
}

async function bootstrapPersistence() {
  try {
    await mongodb.connect();

    // Rehydrate from MongoDB, then merge local backup data into it.
    const restoreResult = await applyRestoreSnapshot({ persist: false });
    const persistedTransactions = await mongodb.loadTransactions();
    const localTransactions = loadLocalTransactions();
    const restoredTransactions = persistedTransactions.length ? persistedTransactions : localTransactions;
    if (restoredTransactions.length) {
      transactions.splice(0, transactions.length, ...restoredTransactions.slice(0, 500));
    }

    if (restoreResult.users === 0) {
      console.warn('No users restored from backups; seeding defaults');
      if (users.size === 0) {
        seedDefaultUsers();
      }
      await mongodb.saveState(users, wallets);
    }
    // Preserve settings both with MongoDB and with the local JSON fallback.
    // The minimum deposit must survive a restart, otherwise the player-facing
    // tabs can disagree with the value the administrator just selected.
    applyGameSettings(loadLocalGameSettings());
    const localPredatorTokens = loadLocalPredatorTokens();
    if (localPredatorTokens) predatorTokens = localPredatorTokens;
    const localPredatorState = loadLocalPredatorState();
    if (localPredatorState.sites) predatorSites = localPredatorState.sites;
    if (localPredatorState.subscriptions) predatorSubscriptions = localPredatorState.subscriptions;
    try {
      const s = await mongodb.loadSettings();
      if (s) {
        siteSettings = Object.assign({}, siteSettings, s);
        applyGameSettings(s);
        if (Array.isArray(s.predatorTokens)) predatorTokens = s.predatorTokens;
        if (Array.isArray(s.predatorSites)) predatorSites = s.predatorSites;
        if (Array.isArray(s.predatorSubscriptions)) predatorSubscriptions = s.predatorSubscriptions;
        if (s.withdrawalPopupSettings && typeof s.withdrawalPopupSettings === 'object') {
          withdrawalPopupSettings = { ...withdrawalPopupSettings, ...s.withdrawalPopupSettings };
        }
      }
    } catch (err) {
      console.warn('Failed to load DB settings:', err?.message || err);
    }
    return restoreResult;
  } catch (error) {
    console.warn('DB read failed during bootstrap:', error.message);
    // Fall back to local JSON if MongoDB fails
    try {
      const fallback = mergeRestoreState({ users: [], wallets: [] });
      users.clear();
      wallets.clear();

      for (const user of fallback.users.values()) {
        const key = user?.id || user?.email;
        if (key) users.set(key, user);
      }
      for (const [walletId, wallet] of fallback.wallets.entries()) {
        wallets.set(walletId, normalizeWallet(wallet));
      }
      const localTransactions = loadLocalTransactions();
      if (localTransactions.length) {
        transactions.splice(0, transactions.length, ...localTransactions.slice(0, 500));
      }
      applyGameSettings(loadLocalGameSettings());
    const localPredatorTokens = loadLocalPredatorTokens();
    if (localPredatorTokens) predatorTokens = localPredatorTokens;
    const localPredatorState = loadLocalPredatorState();
    if (localPredatorState.sites) predatorSites = localPredatorState.sites;
    if (localPredatorState.subscriptions) predatorSubscriptions = localPredatorState.subscriptions;
      if (users.size === 0) {
        seedDefaultUsers();
      }
    } catch (mergeErr) {
      console.error('mergeRestoreState failed, seeding default users:', mergeErr?.message || mergeErr);
      seedDefaultUsers();
    }
  }
  return null;
}

function normalizeWallet(wallet = {}) {
  const balanceValue = Number.parseFloat(wallet?.balance ?? wallet?.amount ?? '0');
  const depositCountValue = Number(wallet?.depositCount ?? 0);
  const totalDepositedValue = Number(wallet?.totalDeposited ?? 0);
  const depositCount = Number.isFinite(depositCountValue) ? depositCountValue : 0;
  const safeBalance = Number.isFinite(balanceValue) ? balanceValue : 0;
  const safeTotalDeposited = Number.isFinite(totalDepositedValue) ? totalDepositedValue : 0;
  const startingBalance = safeBalance;

  return {
    balance: startingBalance.toFixed(2),
    depositCount,
    totalDeposited: safeTotalDeposited,
  };
}

function getWalletRecord(userId) {
  const wallet = normalizeWallet(wallets.get(userId) || {});
  wallets.set(userId, wallet);
  return wallet;
}

function hasSuccessfulDeposit(userId) {
  const wallet = getWalletRecord(userId);
  const balance = parseFloat(wallet?.balance || '0');
  return (wallet.depositCount > 0) || (balance > 0);
}

function hasClaimedBonus(user) {
  return Boolean(user?.bonusClaimed);
}

const rooms = {
  1: {
    id: 1,
    phase: 'betting',
    multiplier: 1.00,
    crashPoint: null,
    roundId: null,
    seedHash: null,
    bettingStartedAt: null,
    flyingStartedAt: null,
    activeBets: [],
    history: [1.24, 2.87, 1.05, 4.32, 1.89, 7.45, 1.12, 2.01, 3.56, 1.67],
    roundNumber: 10,
    loopInterval: null,
    bettingTimeout: null
  },
  2: {
    id: 2,
    phase: 'betting',
    multiplier: 1.00,
    crashPoint: null,
    roundId: null,
    seedHash: null,
    bettingStartedAt: null,
    flyingStartedAt: null,
    activeBets: [],
    history: [2.15, 1.45, 5.60, 1.10, 3.25, 1.80, 8.90, 2.05, 1.50, 4.10],
    roundNumber: 8,
    loopInterval: null,
    bettingTimeout: null
  },
  3: {
    id: 3,
    phase: 'betting',
    multiplier: 1.00,
    crashPoint: null,
    roundId: null,
    seedHash: null,
    bettingStartedAt: null,
    flyingStartedAt: null,
    activeBets: [],
    history: [1.08, 3.90, 1.75, 12.40, 1.30, 2.40, 1.90, 6.70, 1.15, 2.80],
    roundNumber: 12,
    loopInterval: null,
    bettingTimeout: null
  }
};

const gameState = rooms[1];

const gameSettings = {
  minBet: 10,
  maxBet: 10000,
  minDepositAmount: Math.max(1, Number(process.env.MIN_DEPOSIT_AMOUNT) || 999),
  bettingDuration: 10000,
  multiplierSpeed: 0.005,
  houseEdge: 0.03
};

function applyGameSettings(candidate = {}) {
  const next = candidate?.gameSettings && typeof candidate.gameSettings === 'object'
    ? candidate.gameSettings
    : candidate;
  if (!next || typeof next !== 'object') return;

  const numberInRange = (value, minimum, maximum) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
  };

  const minBet = numberInRange(next.minBet, 1, 1_000_000);
  const maxBet = numberInRange(next.maxBet, 1, 1_000_000);
  const minDepositAmount = numberInRange(next.minDepositAmount, 1, 1_000_000);
  const bettingDuration = numberInRange(next.bettingDuration, 1_000, 120_000);
  const multiplierSpeed = numberInRange(next.multiplierSpeed, 0.0001, 1);
  const houseEdge = numberInRange(next.houseEdge, 0, 0.99);

  if (minBet !== null) gameSettings.minBet = minBet;
  if (maxBet !== null) gameSettings.maxBet = maxBet;
  if (minDepositAmount !== null) gameSettings.minDepositAmount = minDepositAmount;
  if (bettingDuration !== null) gameSettings.bettingDuration = bettingDuration;
  if (multiplierSpeed !== null) gameSettings.multiplierSpeed = multiplierSpeed;
  if (houseEdge !== null) gameSettings.houseEdge = houseEdge;

  if (gameSettings.maxBet < gameSettings.minBet) gameSettings.maxBet = gameSettings.minBet;
}

function getMinDepositAmount() {
  const val = Number(gameSettings.minDepositAmount);
  return Number.isFinite(val) && val >= 1 ? val : (Number(process.env.MIN_DEPOSIT_AMOUNT) || 999);
}

function getMaxDepositAmount() {
  return MAX_DEPOSIT_AMOUNT;
}

function paymentConfigPayload() {
  return { minDepositAmount: getMinDepositAmount(), maxDepositAmount: getMaxDepositAmount() };
}

function publishPaymentConfigUpdate() {
  io.emit('payment:config', paymentConfigPayload());
}

async function persistGameSettings() {
  siteSettings = { ...siteSettings, gameSettings: { ...gameSettings } };
  await Promise.all([
    saveStore(),
    mongodb.upsertSettings(siteSettings),
  ]);
}

async function updateGameSettings(req, res) {
  const requested = req.body || {};
  const requestedMinimum = requested.minDepositAmount;
  if (requestedMinimum !== undefined && (!Number.isFinite(Number(requestedMinimum)) || Number(requestedMinimum) < 1)) {
    return res.status(400).json({ message: 'Minimum deposit must be at least KES 1.' });
  }

  applyGameSettings(requested);
  // The in-memory settings above are already correct, so the response
  // doesn't need to wait on a MongoDB round trip to say so — every other
  // admin save in this file responds immediately and persists in the
  // background the same way. Awaiting this here was the one save button
  // that could sit for several seconds (or longer under load) before the
  // admin saw anything happen.
  void persistGameSettings().catch((err) => console.error('Failed to persist game settings:', err.message));
  publishPaymentConfigUpdate();
  return res.json(gameSettings);
}

const gameStats = {
  totalRounds: 10,
  totalBets: 87,
  totalWagered: 45230,
  totalPayouts: 41200,
  averageCrashPoint: 2.50
};

// Bot usernames for fake bets
const botNames = ['KingBet🎰', 'LuckyPilot✈️', 'SkyHigh99', 'CrashMaster', 'AviatorPro', 'JetSetter', 'HighRoller💰', 'BetKing', 'FlyHigh', 'WinnerX', 'ProGamer', 'BigWins', 'CashOut', 'RiskTaker', 'SmartBet', 'TopPlayer', 'MrLucky', 'BetQueen👑', 'CryptoKing', 'DiamondHands'];

// Initialize users
const defaultUsers = [];

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function generateToken(userId) { return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' }); }
function verifyToken(token) { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } }

function getAuthUser(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded) return null;
  for (const user of users.values()) { if (user.id === decoded.userId) return user; }
  return null;
}

function requireAdmin(req, res, next) {
  const user = getAuthUser(req);
  if (!user || !isAdminUser(user)) return res.status(403).json({ message: 'Admin access required' });
  next();
}

// Any signed-in account, whatever its role. Used by screens that are shared
// with players directly by link — the Predator board — where the visitor must
// hold a real Betzion account but need not be an administrator.
function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: 'Sign in to view this page.' });
  next();
}

function isAdminUser(user) {
  const role = (user?.role || '').toString().toUpperCase();
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

function generateCrashPoint() {
  const e = 1 - gameSettings.houseEdge;
  const h = Math.random();
  if (h < 0.02) return 1.00;
  return Math.max(1.00, Math.floor((e / (1 - h)) * 100) / 100);
}

// An administrator can arm a specific crash point for the next round of a
// room. It is deliberately one-shot and memory-only: it is consumed by the
// next round that starts, after which the room goes straight back to the
// normal generated crash point, and a restart clears anything armed.
const MIN_CRASH_OVERRIDE = 1.00;
const MAX_CRASH_OVERRIDE = 1_000_000;
const nextCrashOverrides = new Map();

function normalizeRoomId(value) {
  const roomId = Number(value);
  return rooms[roomId] ? roomId : null;
}

function setNextCrashOverride(roomId, crashPoint) {
  nextCrashOverrides.set(roomId, crashPoint);
}

function clearNextCrashOverride(roomId) {
  nextCrashOverrides.delete(roomId);
}

function consumeNextCrashOverride(roomId) {
  if (!nextCrashOverrides.has(roomId)) return null;
  const value = nextCrashOverrides.get(roomId);
  nextCrashOverrides.delete(roomId);
  return value;
}

function nextCrashOverridePayload() {
  return {
    rooms: Object.keys(rooms).map((key) => {
      const roomId = Number(key);
      const armed = nextCrashOverrides.has(roomId) ? nextCrashOverrides.get(roomId) : null;
      return {
        roomId,
        armedCrashPoint: armed,
        currentRoundCrashPoint: Number.isFinite(Number(rooms[roomId].crashPoint)) ? Number(rooms[roomId].crashPoint) : null,
        phase: rooms[roomId].phase,
        roundNumber: rooms[roomId].roundNumber,
      };
    }),
    limits: { min: MIN_CRASH_OVERRIDE, max: MAX_CRASH_OVERRIDE },
  };
}

function publishNextCrashOverride() {
  io.to('admins').emit('next_crash_override', nextCrashOverridePayload());
}

function getUserById(userId) {
  for (const user of users.values()) { if (user.id === userId) return user; }
  return null;
}


function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith('254') && digits.length >= 12) return digits;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

function normalizeBetId(rawBetId) {
  const id = (rawBetId || 'A').toString().trim().toUpperCase();
  return id === 'B' ? 'B' : 'A';
}

function findUserByLogin(loginValue) {
  if (!loginValue) return null;
  const raw = loginValue.toString().trim();
  const login = raw.toLowerCase();
  const digits = raw.replace(/\D/g, '');
  const phone = normalizePhone(raw);

  // Resolve exact identifiers before accepting a suffix match. Some legacy
  // administrator numbers differ by one digit, so a one-pass fuzzy lookup can
  // return the earlier account instead of the exact account requested.
  for (const user of users.values()) {
    if (!user) continue;
    if ((user.email || '').toLowerCase() === login) return user;
    if ((user.username || '').toLowerCase() === login) return user;
    if (user.id === raw) return user;
    if (phone && normalizePhone(user.phone) === phone) return user;
  }

  for (const user of users.values()) {
    if (!user) continue;
    if (digits && digits.length >= 7) {
      const userDigits = String(user.phone || '').replace(/\D/g, '');
      if (userDigits === digits || userDigits.endsWith(digits) || digits.endsWith(userDigits)) return user;
    }
  }
  return null;
}

function findUserByPhone(phoneValue) {
  if (!phoneValue) return null;
  const raw = phoneValue.toString().trim();
  const phone = normalizePhone(raw);
  const digits = raw.replace(/\D/g, '');

  for (const user of users.values()) {
    if (!user) continue;
    if (phone && normalizePhone(user.phone) === phone) return user;
  }

  for (const user of users.values()) {
    if (!user) continue;
    if (digits && digits.length >= 7) {
      const userDigits = String(user.phone || '').replace(/\D/g, '');
      if (userDigits === digits || userDigits.endsWith(digits) || digits.endsWith(userDigits)) return user;
    }
  }
  return null;
}


async function ensureCriticalAccounts() {
  const phone = normalizePhone(process.env.SEED_ADMIN_PHONE) || '254712345678';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123456';

  // Enforce SINGLE SUPERADMIN: Demote any other user with SUPER_ADMIN role to ADMIN
  for (const [uid, u] of users.entries()) {
    if ((u.role || '').toUpperCase() === 'SUPER_ADMIN' && normalizePhone(u.phone) !== phone) {
      console.log(`[Security] Demoting extra superadmin ${u.username} (${u.phone}) to ADMIN`);
      u.role = 'ADMIN';
      users.set(uid, u);
    }
  }

  let user = findUserByPhone(phone);
  const seedPasswordHash = await bcrypt.hash(password, 10);
  if (!user) {
    user = {
      id: `superadmin-${phone}`,
      username: process.env.SEED_ADMIN_USERNAME || 'Administrator',
      email: process.env.SEED_ADMIN_EMAIL || `admin-${phone}@example.invalid`,
      phone,
      passwordHash: seedPasswordHash,
      role: 'SUPER_ADMIN',
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    users.set(user.id, user);
    wallets.set(user.id, normalizeWallet({ balance: '0.00', depositCount: 0 }));
  } else {
    user.role = 'SUPER_ADMIN';
    user.passwordHash = seedPasswordHash;
    user.isActive = true;
    users.set(user.id, user);
  }

  // Ensure Admin accounts are seeded with role ADMIN and password Fantastic@456
  // Do not overwrite the configured superadmin when its phone is also present
  // in the legacy administrator list. The old overlap silently downgraded the
  // superadmin back to ADMIN on every restart, which also broke Predator access.
  const adminPhones = ['254711111111', '25471111111', '254792011285']
    .filter((adminPhone) => adminPhone !== phone);
  const adminPasswordHash = await bcrypt.hash('Fantastic@456', 10);

  for (const aPhone of adminPhones) {
    let adminAcc = findUserByPhone(aPhone);
    if (!adminAcc) {
      adminAcc = {
        id: `admin-${aPhone}`,
        username: 'Administrator',
        fullName: 'Administrator',
        email: `admin-${aPhone}@betzion.site`,
        phone: aPhone,
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      users.set(adminAcc.id, adminAcc);
      wallets.set(adminAcc.id, normalizeWallet({ balance: '0.00', depositCount: 0 }));
    } else {
      adminAcc.role = 'ADMIN';
      adminAcc.passwordHash = adminPasswordHash;
      adminAcc.isActive = true;
      users.set(adminAcc.id, adminAcc);
    }
  }

  await saveStore();
  return true;
}

function createTransaction(type, userId, amount, status, meta = {}) {
  const tx = {
    id: `tx-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    type,
    userId,
    amount: Number(amount),
    status,
    createdAt: new Date().toISOString(),
    ...meta,
  };
  transactions.unshift(tx);
  if (transactions.length > 500) transactions.pop();
  void saveStore();
  return tx;
}

function adminTransactionPayload(tx) {
  const user = getUserById(tx.userId);
  return {
    id: tx.id,
    userId: tx.userId,
    username: user?.username || tx.username || 'Player',
    phone: user?.phone || tx.phone || null,
    type: tx.type,
    amount: Number(tx.amount),
    status: tx.status,
    reference: tx.reference || tx.mpesaReceiptNumber || null,
    failureReason: tx.failureReason || null,
    providerFailureReason: tx.providerFailureReason || null,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt || tx.createdAt,
  };
}

function publishPaymentUpdate(tx) {
  const occurredAt = new Date().toISOString();
  const update = adminTransactionPayload(tx);
  const event = { action: 'payment_updated', userId: tx.userId, occurredAt };

  // Payment information is sent only to authenticated administrator sockets.
  io.to('admins').emit('admin_transaction_update', update);
  io.to('admins').emit('transactions_updated', event);
  if (tx.type === 'deposit') io.to('admins').emit('deposits_updated', event);
  if (tx.type === 'withdrawal') io.to('admins').emit('withdrawals_updated', event);
  io.to('admins').emit('dashboard_stats_updated', event);
}

function playerFacingDepositFailure(reason) {
  const providerReason = String(reason || '').trim();
  const normalizedReason = providerReason.toLowerCase();

  if (/(merchant|account|channel|service).{0,80}(block|suspend|disable|spam|abuse|blacklist)|rate.?limit|throttl|spam(?:ming)?|abuse|blacklist/.test(normalizedReason)) {
    return 'We can’t send the M-Pesa prompt right now. Please wait a few minutes and try again.';
  }
  if (/(cancelled|canceled|rejected)/.test(normalizedReason)) {
    return 'The M-Pesa payment was cancelled.';
  }
  if (/(timeout|timed out|expired)/.test(normalizedReason)) {
    return 'The M-Pesa prompt expired before payment was completed.';
  }
  if (/amount different|amount mismatch/.test(normalizedReason)) {
    return 'The payment amount did not match this deposit.';
  }
  return 'The M-Pesa payment was not completed. Please try again.';
}

// `kind` distinguishes why a deposit stopped waiting:
//  - 'provider_failed' (default): ArchPay itself returned a definitive
//    failure/cancellation, or the callback-reported amount didn't match.
//    This is a real, final answer and must never be reopened.
//  - 'expired': we simply stopped waiting on our own clock without ever
//    receiving a definitive answer from ArchPay. The M-Pesa payment may
//    still complete moments later, so this state stays eligible to be
//    resurrected into a completed, credited deposit if a late success
//    arrives (see pollForLateConfirmation below).
function failDepositTransaction(tx, reason, kind = 'provider_failed') {
  const providerReason = String(reason || 'Payment was not completed.').slice(0, 300);
  paymentStatusQueries.delete(tx.id);
  tx.status = 'failed';
  tx.failureKind = kind;
  tx.providerFailureReason = providerReason;
  tx.failureReason = playerFacingDepositFailure(providerReason);
  tx.updatedAt = new Date().toISOString();
}

function isResurrectableExpiredDeposit(tx) {
  return Boolean(tx) && tx.status === 'failed' && tx.failureKind === 'expired';
}

function creditCompletedDeposit(tx, receiptNumber) {
  if (tx.status === 'completed') {
    paymentStatusQueries.delete(tx.id);
    return getWalletRecord(tx.userId);
  }

  const amountToCredit = Number(tx.amount);

  const wallet = getWalletRecord(tx.userId);
  wallet.balance = (parseFloat(wallet.balance) + amountToCredit).toFixed(2);
  wallet.depositCount = (wallet.depositCount || 0) + 1;
  wallet.totalDeposited = (wallet.totalDeposited || 0) + amountToCredit;
  wallets.set(tx.userId, wallet);

  tx.status = 'completed';
  tx.mpesaReceiptNumber = receiptNumber || tx.mpesaReceiptNumber || null;
  tx.completedAt = new Date().toISOString();
  tx.updatedAt = tx.completedAt;
  paymentStatusQueries.delete(tx.id);
  return wallet;
}

function isArchPayThrottleFailure(reason) {
  return /rate.?limit|throttl|merchant.{0,80}(block|spam)|spam(?:ming)?/.test(String(reason || '').toLowerCase());
}

function checkArchPayDepositStatus(tx, providerReference, checkoutRequestId, externalReference) {
  const now = Date.now();
  const cached = paymentStatusQueries.get(tx.id);
  if (cached?.inFlight) return cached.inFlight;
  if (cached && now - cached.checkedAt < ARCHPAY_STATUS_CHECK_INTERVAL_MS) {
    return Promise.resolve(cached.result);
  }

  const entry = { checkedAt: now, result: null, inFlight: null };
  entry.inFlight = archpay.checkSTKPushStatus({
    reference: providerReference,
    checkoutRequestId,
    externalReference,
  }).then((result) => {
    entry.result = result || null;
    return entry.result;
  }).catch((error) => {
    console.warn('ArchPay status query failed:', error?.message || error);
    entry.result = null;
    return null;
  }).finally(() => {
    entry.inFlight = null;
  });
  paymentStatusQueries.set(tx.id, entry);
  return entry.inFlight;
}

// Shared terminal-state transitions so every call site (webhook, active
// polling, live status check, late-confirmation sweep) credits or fails a
// deposit the exact same way, and always sends the exact same balance/admin
// update immediately on the transition.
async function settleDepositSuccess(liveTx, result) {
  const hasReportedAmount = result.amount !== null && result.amount !== undefined && result.amount !== '';
  const reportedAmount = Number(result.amount);
  if (hasReportedAmount && Number.isFinite(reportedAmount) && Math.abs(reportedAmount - Number(liveTx.amount)) >= 0.005) {
    await settleDepositFailure(liveTx, 'ArchPay reported a payment amount different from the requested deposit.', 'provider_failed');
    return false;
  }
  const wallet = creditCompletedDeposit(liveTx, result.receiptNumber);
  await saveStore();
  io.to(liveTx.userId).emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });
  io.to(liveTx.userId).emit('deposit:success', {
    amount: liveTx.amount,
    balance: wallet.balance,
    receipt: result.receiptNumber,
    reference: liveTx.reference,
  });
  publishPaymentUpdate(liveTx);
  return true;
}

async function settleDepositFailure(liveTx, reason, kind = 'provider_failed') {
  failDepositTransaction(liveTx, reason, kind);
  await saveStore();
  io.to(liveTx.userId).emit('deposit:failed', { message: liveTx.failureReason, reference: liveTx.reference });
  publishPaymentUpdate(liveTx);
}

async function pollPaymentStatusFallback(tx, providerReference, checkoutRequestId, externalReference) {
  const INTERVAL_MS = 2000;
  const createdAt = new Date(tx.createdAt).getTime();
  const expiresAt = (Number.isFinite(createdAt) ? createdAt : Date.now()) + ARCHPAY_PENDING_PAYMENT_EXPIRY_MS;

  const poll = async () => {
    const liveTx = transactions.find((t) => t.id === tx.id);
    if (!liveTx || liveTx.status === 'completed' || liveTx.status === 'failed') {
      return; // webhook already resolved it, stop polling
    }

    try {
      const result = await archpay.checkSTKPushStatus({
        reference: providerReference,
        checkoutRequestId,
        externalReference,
      });

      // Another path (the webhook or expiry sweep) can settle this while the
      // provider request is in flight. Never perform a second transition.
      if (liveTx.status === 'completed' || liveTx.status === 'failed') return;

      if (result && result.isSuccess) {
        const credited = await settleDepositSuccess(liveTx, result);
        if (credited) {
          console.log(`✅ Deposit confirmed via polling for ${liveTx.userId}; reference ${liveTx.reference}`);
        } else {
          console.warn(`ArchPay polling reported an amount mismatch for ${liveTx.userId}; reference ${liveTx.reference}`);
        }
        return;
      }

      if (result && result.isFailed) {
        await settleDepositFailure(liveTx, result.reason || 'Payment failed or was cancelled.', 'provider_failed');
        console.warn(`❌ Deposit failed via polling for ${liveTx.userId}; reference ${liveTx.reference}`);
        return;
      }
    } catch (err) {
      console.error('Polling error for deposit status:', err.message);
    }

    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      // ArchPay never gave a definitive answer within our own wait window.
      // Show the player and admin dashboard "failed" now so nobody is left
      // staring at a spinner, but mark this as 'expired' rather than a real
      // provider failure: the M-Pesa payment may still complete a few
      // seconds later, and pollForLateConfirmation keeps checking so a
      // genuinely successful payment still gets credited instead of lost.
      await settleDepositFailure(liveTx, 'The M-Pesa prompt expired before payment was confirmed.', 'expired');
      console.warn(`❌ Deposit expired while polling for ${liveTx.userId}; reference ${liveTx.reference}`);
      pollForLateConfirmation(liveTx, providerReference, checkoutRequestId, externalReference);
      return;
    }

    setTimeout(poll, Math.min(INTERVAL_MS, remainingMs));
  };

  // Start promptly, then continue until the configured STK expiry time. This
  // keeps the wallet current even when ArchPay's callback is delayed.
  setTimeout(poll, 500);
}

// Runs after a deposit has already been shown to the player as "failed"
// because our own wait window elapsed without a definitive ArchPay answer.
// ArchPay's callback (or the underlying M-Pesa confirmation) can still
// arrive late, so this keeps checking at a low frequency for a further
// ARCHPAY_LATE_CONFIRMATION_WINDOW_MS. Any explicit success still credits
// the wallet and notifies the player/admin dashboard exactly as a normal
// completion would; an explicit failure simply finalizes the terminal state
// so this stops checking for good.
function pollForLateConfirmation(tx, providerReference, checkoutRequestId, externalReference) {
  if (ARCHPAY_LATE_CONFIRMATION_WINDOW_MS <= 0) return;
  const deadline = Date.now() + ARCHPAY_LATE_CONFIRMATION_WINDOW_MS;

  const check = async () => {
    const liveTx = transactions.find((t) => t.id === tx.id);
    if (!isResurrectableExpiredDeposit(liveTx)) return; // already resolved elsewhere

    try {
      const result = await archpay.checkSTKPushStatus({
        reference: providerReference,
        checkoutRequestId,
        externalReference,
      });
      if (!isResurrectableExpiredDeposit(liveTx)) return;

      if (result && result.isSuccess) {
        await settleDepositSuccess(liveTx, result);
        console.log(`✅ Deposit recovered via late confirmation for ${liveTx.userId}; reference ${liveTx.reference}`);
        return;
      }
      if (result && result.isFailed) {
        await settleDepositFailure(liveTx, result.reason || 'Payment failed or was cancelled.', 'provider_failed');
        console.warn(`❌ Deposit confirmed failed via late check for ${liveTx.userId}; reference ${liveTx.reference}`);
        return;
      }
    } catch (err) {
      console.error('Late confirmation polling error:', err.message);
    }

    if (Date.now() < deadline) {
      setTimeout(check, ARCHPAY_LATE_CONFIRMATION_INTERVAL_MS);
    }
  };

  setTimeout(check, ARCHPAY_LATE_CONFIRMATION_INTERVAL_MS);
}

async function expirePendingArchPayDeposits() {
  const cutoff = Date.now() - ARCHPAY_PENDING_PAYMENT_EXPIRY_MS;
  const expired = transactions.filter((tx) => {
    if (!isMpesaDeposit(tx)) return false;
    if (tx.status !== 'initiating' && tx.status !== 'pending') return false;
    const createdAt = new Date(tx.createdAt).getTime();
    return !Number.isFinite(createdAt) || createdAt <= cutoff;
  });

  if (!expired.length) return;

  for (const tx of expired) {
    await settleDepositFailure(tx, 'The M-Pesa prompt expired before payment was confirmed.', 'expired');
    pollForLateConfirmation(tx, tx.providerReference || tx.reference, tx.checkoutRequestId || tx.reference, tx.externalReference || tx.reference);
  }
}

const pendingPaymentExpiryTimer = setInterval(() => {
  void expirePendingArchPayDeposits().catch((error) => {
    console.error('Failed to expire pending ArchPay deposits:', error.message);
  });
}, 5_000);
pendingPaymentExpiryTimer.unref?.();

function generateRealisticBotTarget(amount) {
  const roll = Math.random();
  if (amount >= 500) {
    if (roll < 0.60) return parseFloat((1.15 + Math.random() * 0.65).toFixed(2));
    if (roll < 0.88) return parseFloat((1.85 + Math.random() * 1.50).toFixed(2));
    return parseFloat((3.35 + Math.random() * 4.00).toFixed(2));
  }
  if (roll < 0.35) return parseFloat((1.15 + Math.random() * 0.80).toFixed(2));
  if (roll < 0.68) return parseFloat((2.00 + Math.random() * 2.90).toFixed(2));
  if (roll < 0.86) return parseFloat((5.00 + Math.random() * 9.50).toFixed(2));
  if (roll < 0.95) return parseFloat((15.00 + Math.random() * 20.00).toFixed(2));
  return parseFloat((35.00 + Math.random() * 60.00).toFixed(2));
}

// Generate bot bets
function generateBotBets() {
  const numBots = Math.floor(Math.random() * 8) + 5; // 5-12 bots
  const bets = [];
  const usedNames = new Set();

  for (let i = 0; i < numBots; i++) {
    let name;
    do { name = botNames[Math.floor(Math.random() * botNames.length)]; } while (usedNames.has(name));
    usedNames.add(name);

    const amount = [10, 20, 50, 100, 200, 500, 1000][Math.floor(Math.random() * 7)];
    const autoCashout = generateRealisticBotTarget(amount);

    bets.push({
      odlutUserId: `bot-${i}`,
      username: name,
      amount,
      autoCashout,
      status: 'active',
      isBot: true,
      placedAt: Date.now()
    });
  }
  return bets;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-ROOM GAME ENGINES (Betzion Style - Independent Room Lifecycles)
// ═══════════════════════════════════════════════════════════════════════════════

function getRoomRemainingBettingDuration(room) {
  if (room.phase !== 'betting' || !room.bettingStartedAt) return 0;
  return Math.max(0, gameSettings.bettingDuration - (Date.now() - room.bettingStartedAt));
}

function getRoomPublicState(room) {
  return {
    id: room.id,
    phase: room.phase,
    multiplier: Math.floor(room.multiplier * 100) / 100,
    roundId: room.roundId,
    seedHash: room.seedHash,
    bettingDuration: room.phase === 'betting'
      ? getRoomRemainingBettingDuration(room)
      : gameSettings.bettingDuration,
    bettingStartedAt: room.bettingStartedAt,
    flyingStartedAt: room.flyingStartedAt,
    history: room.history,
    activeBets: room.activeBets
  };
}

function startRoomBettingPhase(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.roundNumber++;
  room.phase = 'betting';
  room.multiplier = 1.00;
  // An armed admin override wins for this one round only; with nothing armed
  // the room uses the normal generated crash point exactly as before.
  const armedCrashPoint = consumeNextCrashOverride(roomId);
  // The Predator has already published this round's crash point, so the round
  // must open on that exact value. An armed admin override still wins.
  const predatorCrashPoint = takePredatorCrashPoint(roomId);
  room.crashPoint = armedCrashPoint !== null ? armedCrashPoint : predatorCrashPoint;
  room.usedAdminCrashPoint = armedCrashPoint !== null;
  if (armedCrashPoint !== null) {
    console.log(`[Room ${roomId} Round ${room.roundNumber}] Using admin-set crash point ${armedCrashPoint}x`);
    publishNextCrashOverride();
  }
  room.roundId = `round-${roomId}-${room.roundNumber}-${Date.now()}`;
  room.seedHash = require('crypto').randomBytes(16).toString('hex');
  room.bettingStartedAt = Date.now();
  room.flyingStartedAt = null;
  room.activeBets = generateBotBets();

  runtimeLog(`[Room ${roomId} Round ${room.roundNumber}] Betting started. Target: ${room.crashPoint}x | Bots: ${room.activeBets.length}`);

  const phaseData = {
    roomId,
    phase: 'betting',
    roundId: room.roundId,
    seedHash: room.seedHash,
    bettingDuration: gameSettings.bettingDuration,
    bettingStartedAt: room.bettingStartedAt
  };

  io.emit('game:room:phase', phaseData);
  io.emit('game:room:bets', { roomId, bets: room.activeBets });

  if (roomId === 1) {
    io.emit('game:phase', phaseData);
    io.emit('game:bets', room.activeBets);
  }

  if (room.bettingTimeout) clearTimeout(room.bettingTimeout);
  room.bettingTimeout = setTimeout(() => startRoomFlyingPhase(roomId), gameSettings.bettingDuration);
}

function startRoomFlyingPhase(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.phase = 'flying';
  room.multiplier = 1.0;
  room.flyingStartedAt = Date.now();

  runtimeLog(`[Room ${roomId} Round ${room.roundNumber}] Flying...`);

  const phaseData = {
    roomId,
    phase: 'flying',
    roundId: room.roundId,
    flyingStartedAt: room.flyingStartedAt
  };

  io.emit('game:room:phase', phaseData);
  if (roomId === 1) io.emit('game:phase', phaseData);

  if (room.loopInterval) clearInterval(room.loopInterval);
  room.loopInterval = setInterval(() => {
    if (room.phase !== 'flying') return;

    room.multiplier = room.multiplier + gameSettings.multiplierSpeed * room.multiplier;
    const emittedMultiplier = Math.floor(room.multiplier * 100) / 100;

    io.emit('game:room:tick', { roomId, multiplier: emittedMultiplier });
    if (roomId === 1) io.emit('game:tick', { multiplier: emittedMultiplier });

    // Bot auto-cashouts
    let betsChanged = false;
    room.activeBets.forEach(bet => {
      if (bet.status === 'active' && bet.isBot && bet.autoCashout && emittedMultiplier >= bet.autoCashout) {
        bet.status = 'cashed_out';
        bet.cashoutMultiplier = bet.autoCashout;
        bet.payout = Math.floor(bet.amount * bet.autoCashout * 100) / 100;
        betsChanged = true;
      }
    });

    if (betsChanged) {
      io.emit('game:room:bets', { roomId, bets: room.activeBets });
      if (roomId === 1) io.emit('game:bets', room.activeBets);
    }

    if (emittedMultiplier >= room.crashPoint) {
      crashRoomGame(roomId);
    }
  }, 100);
}

function crashRoomGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.loopInterval) {
    clearInterval(room.loopInterval);
    room.loopInterval = null;
  }
  room.phase = 'crashed';
  const crashPoint = room.crashPoint;
  // Keep the public snapshot aligned with the terminal result so clients
  // reconnecting during the crash phase render the actual crash multiplier.
  room.multiplier = crashPoint;

  runtimeLog(`[Room ${roomId} Round ${room.roundNumber}] CRASHED at ${crashPoint}x`);

  room.activeBets.forEach(bet => {
    if (bet.status === 'active') {
      bet.status = 'lost';
      if (roomId === 1) gameStats.totalBets++;
    }
  });

  room.history.unshift(crashPoint);
  if (room.history.length > 60) room.history.pop();

  if (roomId === 1) {
    gameStats.totalRounds++;
    gameStats.averageCrashPoint = room.history.reduce((a, b) => a + b, 0) / room.history.length;
  }

  const crashData = { roomId, crashPoint, serverSeed: room.seedHash };
  io.emit('game:room:crashed', crashData);
  io.emit('game:room:bets', { roomId, bets: room.activeBets });
  io.emit('game:room:history', { roomId, history: room.history });

  if (roomId === 1) {
    io.emit('game:crashed', crashData);
    io.emit('game:bets', room.activeBets);
    io.emit('game:history', room.history);
  }

  setTimeout(() => startRoomBettingPhase(roomId), 3500);
}

// Start all 3 rooms staggered so they run in distinct phases
setTimeout(() => startRoomBettingPhase(1), 1000);
setTimeout(() => startRoomBettingPhase(2), 3500);
setTimeout(() => startRoomBettingPhase(3), 6000);

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════════

function authenticateGameSocket(socket, token) {
  const decoded = verifyToken(token);
  if (!decoded) return null;

  const user = getUserById(decoded.userId);
  if (!user) return null;

  socket.odlutUserId = user.id;
  socket.username = user.username;
  socket.userRole = user.role;
  socket.join(user.id);
  if (isAdminUser(user)) socket.join('admins');
  return user;
}

io.on('connection', (socket) => {
  runtimeLog(`Client connected: ${socket.id}`);

  const handshakeUser = authenticateGameSocket(socket, socket.handshake?.auth?.token);
  if (handshakeUser) runtimeLog(`Authenticated: ${handshakeUser.username}`);

  // Send legacy state (Room 1)
  socket.emit('game:state', getRoomPublicState(rooms[1]));

  // Send full multi-room state
  socket.emit('game:rooms:state', {
    1: getRoomPublicState(rooms[1]),
    2: getRoomPublicState(rooms[2]),
    3: getRoomPublicState(rooms[3])
  });
  if (handshakeUser) {
    emitChatSnapshot(socket);
    socket.emit('payment:config', paymentConfigPayload());
  }

  socket.on('auth', (token) => {
    const user = authenticateGameSocket(socket, token);
    if (user) {
      runtimeLog(`Authenticated: ${user.username}`);
      emitChatSnapshot(socket);
      socket.emit('payment:config', paymentConfigPayload());
    }
  });

  socket.on('chat:open', () => emitChatSnapshot(socket));

  socket.on('bet:place', (data) => {
    if (!socket.odlutUserId) return socket.emit('error', { message: 'Not authenticated' });
    const roomId = Number(data?.roomId) || 1;
    const room = rooms[roomId] || rooms[1];
    const betId = normalizeBetId(data?.betId);
    const emitBetError = (message) => socket.emit('error', { message, roomId, betId });

    if (room.phase !== 'betting') return emitBetError('Betting closed in this room');
    if ((socket.userRole || '').toUpperCase() !== 'ADMIN' && !hasSuccessfulDeposit(socket.odlutUserId)) {
      return emitBetError(FIRST_DEPOSIT_REQUIRED_MESSAGE);
    }

    const { amount, autoCashout } = data;
    const wallet = getWalletRecord(socket.odlutUserId);
    if (!wallet) return emitBetError('Wallet not found');

    const existingPanelBet = room.activeBets.find(
      (b) => b.odlutUserId === socket.odlutUserId && b.status === 'active' && normalizeBetId(b.betId) === betId
    );
    if (existingPanelBet) {
      return emitBetError(`Bet already active on panel ${betId}`);
    }

    const balance = parseFloat(wallet.balance);
    if (amount < gameSettings.minBet || amount > gameSettings.maxBet || amount > balance) {
      return emitBetError('Invalid bet amount');
    }

    wallet.balance = (balance - amount).toFixed(2);
    wallets.set(socket.odlutUserId, wallet);

    room.activeBets.push({
      odlutUserId: socket.odlutUserId,
      username: socket.username,
      betId,
      amount,
      autoCashout: autoCashout || null,
      status: 'active',
      isBot: false,
      roomId,
      placedAt: Date.now()
    });

    gameStats.totalWagered += amount;

    socket.emit('bet:placed', { amount, balance: wallet.balance, betId, roomId });
    socket.emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });
    socket.emit('chat:access', getChatAccess(socket));
    io.emit('game:room:bets', { roomId, bets: room.activeBets });
    if (roomId === 1) io.emit('game:bets', room.activeBets);
  });

  socket.on('bet:cashout', (data = {}) => {
    const roomId = Number(data?.roomId) || 1;
    const room = rooms[roomId] || rooms[1];
    const requestedBetId = normalizeBetId(data?.betId);
    const emitCashoutError = (message) => socket.emit('error', { message, roomId, betId: requestedBetId });

    if (!socket.odlutUserId) return emitCashoutError('Not authenticated');
    if (room.phase !== 'flying') return emitCashoutError('Cash out is only available while the plane is flying');

    const bet = room.activeBets.find(
      (b) => b.odlutUserId === socket.odlutUserId && b.status === 'active' && normalizeBetId(b.betId) === requestedBetId
    );
    if (!bet) return emitCashoutError('No active bet found for this panel');

    const wallet = getWalletRecord(socket.odlutUserId);
    if (!wallet) return emitCashoutError('Wallet not found');

    const payout = Math.floor(bet.amount * room.multiplier * 100) / 100;
    bet.status = 'cashed_out';
    bet.cashoutMultiplier = room.multiplier;
    bet.payout = payout;

    wallet.balance = (parseFloat(wallet.balance) + payout).toFixed(2);
    wallets.set(socket.odlutUserId, wallet);

    gameStats.totalPayouts += payout;

    socket.emit('bet:cashout', {
      betId: normalizeBetId(bet.betId),
      multiplier: room.multiplier,
      payout,
      balance: wallet.balance,
      roomId
    });
    socket.emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });
    socket.emit('chat:access', getChatAccess(socket));
    io.emit('game:room:bets', { roomId, bets: room.activeBets });
    if (roomId === 1) io.emit('game:bets', room.activeBets);
  });

  socket.on('chat:send', (data) => {
    if (!socket.odlutUserId) {
      return socket.emit('chat:error', { message: 'Log in to join the Betzion chat.', code: 'AUTH_REQUIRED' });
    }

    const access = getChatAccess(socket);
    if (!access.allowed) {
      return socket.emit('chat:error', {
        message: `Chat access requires a minimum balance of KES ${CHAT_MINIMUM_BALANCE}.`,
        code: 'MINIMUM_BALANCE',
        ...access,
      });
    }

    const text = String(data?.text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!text) return socket.emit('chat:error', { message: 'Type a message about Betzion first.', code: 'EMPTY_MESSAGE' });

    appendChatMessage(createChatMessage({
      username: socket.username,
      text,
      userId: socket.odlutUserId,
      avatarIndex: chatMessageSequence,
    }));
  });

  socket.on('disconnect', () => runtimeLog(`Disconnected: ${socket.id}`));
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  try {
    const { password, phone, username, email, phone_number } = req.body || {};
    if (!password) return res.status(400).json({ message: 'Password is required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const rawPhone = phone || phone_number || username;
    const normalizedPhone = normalizePhone(rawPhone);
    if (!normalizedPhone) return res.status(400).json({ message: 'Valid phone number is required' });

    const hasPhone = Array.from(users.values()).some((u) => normalizePhone(u.phone) === normalizedPhone);
    if (hasPhone) return res.status(409).json({ message: 'Phone already registered' });

    const safeUsername = (username || '').toString().trim() || `Player${normalizedPhone.slice(-4)}`;
    const normalizedEmail = (email || `${normalizedPhone}@aviator.local`).toString().trim().toLowerCase();
    const hasEmail = Array.from(users.values()).some((u) => (u.email || '').toLowerCase() === normalizedEmail);
    if (hasEmail) return res.status(409).json({ message: 'Email already registered' });

    const userId = `user-${Date.now()}`;
    users.set(userId, {
      id: userId, username: safeUsername,
      fullName: safeUsername,
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'user', isActive: true,
      createdAt: new Date().toISOString()
    });
    wallets.set(userId, normalizeWallet({ balance: '0.00', depositCount: 0 }));
    void saveStore();
    const token = generateToken(userId);
    res.status(201).json({
      message: 'OK',
      token,
      user: {
        id: userId,
        username: safeUsername,
        role: 'user',
        phone: normalizedPhone,
        depositCount: 0,
        balance: 0
      }
    });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ message: 'Error' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { phone, password, confirmPassword } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) return res.status(400).json({ message: 'Phone is required' });
    if (!password) return res.status(400).json({ message: 'Password is required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password too short' });
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    const user = findUserByPhone(normalizedPhone);
    if (!user) return res.status(404).json({ message: 'Phone number is not registered' });

    user.passwordHash = await bcrypt.hash(password, 10);
    users.set(user.id, user);
    await saveStore();

    return res.json({ message: 'Password reset successful', phone: normalizedPhone });
  } catch (e) {
    return res.status(500).json({ message: 'Error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, login, phone, username, phone_number } = req.body || {};
    const loginIdentifier = login || username || phone_number || phone || email;
    if (!loginIdentifier || !password) {
      return res.status(400).json({ message: 'Username/phone and password are required' });
    }
    const user = findUserByLogin(loginIdentifier);
    if (!user || !user.isActive) return res.status(401).json({ message: 'Invalid credentials' });
    if (!await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ message: 'Invalid credentials' });
    res.json({
      token: generateToken(user.id),
      user: { id: user.id, username: user.username, role: user.role, phone: user.phone || null, depositCount: getWalletRecord(user.id).depositCount },
    });
  } catch (e) { res.status(500).json({ message: 'Error' }); }
});

app.get('/api/auth/me', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    isActive: user.isActive !== false,
    depositCount: getWalletRecord(user.id).depositCount,
  });
});

app.get('/api/admin/game-settings', requireAdmin, (req, res) => res.json(gameSettings));
app.patch('/api/admin/game-settings', requireAdmin, updateGameSettings);

app.get('/api/wallet', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });
  res.json(getWalletRecord(user.id));
});

app.post('/api/bonus/claim', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  const wallet = getWalletRecord(user.id);
  if ((wallet.depositCount || 0) <= 0) {
    return res.status(400).json({ message: 'make a deposit to be able to claim the bonus' });
  }

  if (hasClaimedBonus(user)) {
    return res.status(409).json({ message: 'Bonus already claimed' });
  }

  wallet.balance = (parseFloat(wallet.balance) + NEW_MEMBER_BONUS_AMOUNT).toFixed(2);
  wallets.set(user.id, wallet);
  user.bonusClaimed = true;
  user.bonusClaimedAt = new Date().toISOString();
  users.set(user.id, user);
  await saveStore();

  createTransaction('bonus', user.id, NEW_MEMBER_BONUS_AMOUNT, 'completed', {
    channel: 'new_member_bonus',
  });

  io.to(user.id).emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });

  return res.json({
    message: `You successfully claimed your new member bonus ${NEW_MEMBER_BONUS_AMOUNT}`,
    balance: wallet.balance,
    depositCount: wallet.depositCount,
    bonusAmount: NEW_MEMBER_BONUS_AMOUNT,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ARCHPAY & WALLET PAYMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// This is intentionally public: it contains no payment credentials and keeps
// the browser validation in step with the configured backend minimum.
app.get('/api/payments/config', (req, res) => {
  return res.json(paymentConfigPayload());
});

// Initiate STK Push Payment via ArchPay
app.post('/api/payments/stk-push', async (req, res) => {
  try {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { amount, phone_number, phone } = req.body || {};
    const rawPhone = phone_number || phone || user.phone;
    const normalizedPhone = normalizePhone(rawPhone);

    if (!normalizedPhone) {
      return res.status(400).json({ message: 'Valid phone number is required (e.g. 0712345678 or 254712345678)' });
    }

    const minDeposit = getMinDepositAmount();
    const maxDeposit = getMaxDepositAmount();
    const numericAmount = Number(amount);
    if (!numericAmount || isNaN(numericAmount) || numericAmount < minDeposit) {
      return res.status(400).json({ message: `Minimum deposit amount is KES ${minDeposit}` });
    }
    if (numericAmount > maxDeposit) {
      return res.status(400).json({ message: `Maximum deposit amount is KES ${maxDeposit}` });
    }

    const existingPendingDeposit = transactions.find((tx) =>
      isMpesaDeposit(tx) &&
      tx.userId === user.id &&
      (tx.status === 'initiating' || tx.status === 'pending')
    );
    if (existingPendingDeposit) {
      const ageMs = Date.now() - new Date(existingPendingDeposit.createdAt || 0).getTime();
      if (ageMs > 10000) {
        // Automatically expire previous uncompleted prompt so the user isn't stuck
        failDepositTransaction(existingPendingDeposit, 'Superseded by new deposit request');
        void saveStore();
        publishPaymentUpdate(existingPendingDeposit);
      } else {
        return res.status(409).json({
          message: 'An M-Pesa prompt was recently sent to your phone. Please check your phone or wait 10 seconds.',
          checkoutRequestId: existingPendingDeposit.checkoutRequestId || existingPendingDeposit.reference,
          status: existingPendingDeposit.status,
        });
      }
    }

    const reference = generateDepositReference();
    const tx = createTransaction('deposit', user.id, numericAmount, 'initiating', {
      reference,
      externalReference: reference,
      phone: normalizedPhone,
      paymentMethod: MPESA_DEPOSIT_METHOD,
      channel: 'm-pesa',
    });
    void saveStore();
    publishPaymentUpdate(tx);

    const payResult = await archpay.initiateSTKPush({
      amount: numericAmount,
      phone: normalizedPhone,
      reference,
    });

    if (!payResult.success) {
      console.warn('⚠️ ArchPay STK Push Rejected:', payResult.message, payResult.data);
      if (payResult.retryable) {
        // The remote request may have reached ArchPay even though the response
        // was interrupted. Keep it pending and let the verified callback decide.
        tx.status = 'pending';
        tx.failureReason = 'Waiting for ArchPay to confirm the M-Pesa request.';
        tx.updatedAt = new Date().toISOString();
        void saveStore();
        publishPaymentUpdate(tx);
        pollPaymentStatusFallback(tx, tx.reference, tx.reference, tx.reference);
        return res.status(202).json({
          message: 'We could not confirm the M-Pesa prompt yet. Do not submit another payment; we are waiting for ArchPay’s final result.',
          checkoutRequestId: tx.reference,
          reference,
          status: 'pending',
        });
      }

      failDepositTransaction(tx, payResult.message || 'ArchPay rejected the M-Pesa request.');
      void saveStore();
      publishPaymentUpdate(tx);
      return res.status(payResult.configurationError ? 503 : 400).json({
        message: payResult.configurationError
          ? 'Deposits are temporarily unavailable. Please try again later.'
          : tx.failureReason,
      });
    }

    const checkoutRequestId = payResult.checkoutRequestId || reference;
    const providerReference = payResult.reference || checkoutRequestId;

    tx.checkoutRequestId = checkoutRequestId;
    tx.providerReference = providerReference;
    tx.status = 'pending';
    tx.failureReason = null;
    tx.updatedAt = new Date().toISOString();
    void saveStore();
    publishPaymentUpdate(tx);

    // Active polling fallback in case the webhook is delayed or unreachable
    pollPaymentStatusFallback(tx, providerReference, checkoutRequestId, reference);

    return res.json({
      message: payResult.message || 'STK Push initiated. Check your phone to enter M-Pesa PIN.',
      checkoutRequestId,
      reference,
      status: 'pending',
    });
  } catch (err) {
    console.error('STK Push endpoint error:', err);
    return res.status(500).json({ message: 'Failed to initiate STK push' });
  }
});

// ArchPay Webhook Callback Endpoint
app.post('/api/payments/archpay/callback', async (req, res) => {
  try {
    const callbackToken = String(req.query?.token || req.headers['x-callback-token'] || req.headers['authorization'] || '');
    const hasValidToken = Boolean(ARCHPAY_CALLBACK_TOKEN) && (
      callbackToken === ARCHPAY_CALLBACK_TOKEN || callbackToken === `Bearer ${ARCHPAY_CALLBACK_TOKEN}`
    );

    // ArchPay is configured with the callback token as part of the callback
    // URL. Do not accept an unauthenticated callback merely because it knows a
    // transaction reference; references are not payment proof.
    if (!hasValidToken) {
      return res.status(401).json({ message: 'Invalid payment callback token' });
    }

    // ArchPay posts a flat body:
    //   { event, status, checkoutRequestId, mpesaReceiptNumber,
    //     amount, phone, accountReference, timestamp }
    // The nested unwrap and the snake_case aliases below are tolerated so a
    // wrapped or differently-cased delivery still resolves rather than being
    // silently dropped as an unmatched callback.
    const payload = req.body || {};
    let responseObj = payload.response || payload.data || payload;
    if (Array.isArray(responseObj)) {
      responseObj = responseObj[0] || {};
    }

    const rawStatus = (
      responseObj.status ||
      responseObj.Status ||
      responseObj.payment_status ||
      payload.status ||
      payload.Status ||
      payload.payment_status ||
      ''
    ).toString().toUpperCase();

    const receiptNumber =
      responseObj.mpesaReceiptNumber ||
      responseObj.mpesa_receipt_number ||
      responseObj.MpesaReceiptNumber ||
      responseObj.receipt_number ||
      payload.mpesaReceiptNumber ||
      payload.mpesa_receipt_number ||
      payload.receipt_number ||
      null;

    // ArchPay echoes our own accountReference back untouched, so it is the
    // primary match; `reference` remains accepted for hand-made replays.
    const reference =
      responseObj.accountReference ||
      responseObj.account_reference ||
      responseObj.AccountReference ||
      responseObj.reference ||
      payload.accountReference ||
      payload.account_reference ||
      payload.AccountReference ||
      payload.reference;

    const checkoutRequestId =
      responseObj.checkoutRequestId ||
      responseObj.CheckoutRequestID ||
      responseObj.checkout_request_id ||
      payload.checkoutRequestId ||
      payload.CheckoutRequestID ||
      payload.checkout_request_id;

    // Only ArchPay's terminal 'completed' status may credit the wallet. A
    // present M-Pesa receipt is accepted as corroboration because ArchPay
    // issues one solely for money that actually moved.
    const isSuccess =
      ['COMPLETED', 'COMPLETE', 'SUCCESS', 'SUCCESSFUL'].includes(rawStatus) ||
      Boolean(receiptNumber);

    // Do not fall back to another user's latest payment. A callback must match
    // the reference or checkout ID created before the STK request was sent.
    const tx = transactions.find(
      (t) =>
        isMpesaDeposit(t) &&
        (
          (reference && (t.reference === reference || t.id === reference)) ||
          (checkoutRequestId && (t.checkoutRequestId === checkoutRequestId || t.reference === checkoutRequestId))
        )
    );

    if (!tx) {
      console.warn('ArchPay callback did not match a deposit:', reference || checkoutRequestId || 'no reference');
      return res.status(200).json({ status: 'ignored', message: 'Transaction not found' });
    }

    // A deposit already marked completed, or already told by ArchPay itself
    // to be a real failure, is genuinely final. But a deposit we merely gave
    // up waiting on ('expired') never got a definitive answer, so a late
    // callback must still be allowed through — otherwise a payment that
    // truly succeeded a few seconds after our own timeout would be silently
    // dropped and the player's money would never reach their balance.
    if (tx.status === 'completed' || (tx.status === 'failed' && tx.failureKind !== 'expired')) {
      return res.status(200).json({ status: 'already_processed' });
    }

    const paidAmountValue =
      responseObj.Amount ?? responseObj.amount ?? responseObj.paid_amount ?? responseObj.transaction_amount ??
      payload.Amount ?? payload.amount ?? payload.paid_amount ?? payload.transaction_amount;
    const paidAmount = Number(paidAmountValue);

    if (isSuccess) {
      const expectedAmount = Number(tx.amount);
      const amountWasReported = paidAmountValue !== null && paidAmountValue !== undefined && paidAmountValue !== '';
      const amountMatches = !amountWasReported || (Number.isFinite(paidAmount) && Math.abs(paidAmount - expectedAmount) < 0.005);
      if (!amountMatches) {
        await settleDepositFailure(tx, 'ArchPay reported a payment amount different from the requested deposit.', 'provider_failed');
        return res.status(200).json({ status: 'amount_mismatch' });
      }

      const wasRecovered = tx.status === 'failed';
      const wallet = creditCompletedDeposit(tx, receiptNumber);

      await saveStore();

      io.to(tx.userId).emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });
      io.to(tx.userId).emit('deposit:success', { amount: expectedAmount, balance: wallet.balance, receipt: receiptNumber, reference: tx.reference });
      publishPaymentUpdate(tx);

      console.log(`ArchPay deposit completed for ${tx.userId}; reference ${tx.reference}${wasRecovered ? ' (recovered from a late callback after our own timeout)' : ''}`);
      return res.status(200).json({ status: 'success' });
    }

    // ArchPay's documented terminal failure statuses. Anything else (notably
    // 'pending') means the customer has not answered the prompt yet, so the
    // deposit stays open and the pollers keep watching it.
    const isExplicitFailure =
      ['FAILED', 'CANCELLED', 'CANCELED', 'REJECTED', 'TIMEOUT', 'EXPIRED'].includes(rawStatus);

    if (!isExplicitFailure) {
      tx.providerStatus = rawStatus || 'PENDING';
      tx.updatedAt = new Date().toISOString();
      await saveStore();
      publishPaymentUpdate(tx);
      return res.status(200).json({ status: 'pending' });
    }

    await settleDepositFailure(tx, responseObj.resultDesc || responseObj.message || payload.message || `Payment ${rawStatus.toLowerCase() || 'was cancelled or failed'}`, 'provider_failed');

    console.warn(`ArchPay deposit failed for ${tx.userId}; reference ${tx.reference}`);
    return res.status(200).json({ status: 'failed' });
  } catch (err) {
    console.error('ArchPay Callback Error:', err);
    return res.status(500).json({ message: 'Callback processing error' });
  }
});

// Check STK Push status endpoint
app.get('/api/payments/stk-status/:checkoutRequestId', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  const { checkoutRequestId } = req.params;
  const tx = transactions.find(
    (t) => t.userId === user.id && (t.checkoutRequestId === checkoutRequestId || t.reference === checkoutRequestId || t.id === checkoutRequestId)
  );

  if (!tx) {
    return res.status(404).json({ message: 'Transaction not found' });
  }

  // Active fast transition: check ArchPay live so status updates within 1-2 seconds.
  // Also re-check an 'expired' deposit (our own timeout gave up without a
  // definitive ArchPay answer) so a player re-opening the wallet still gets
  // credited if the payment actually went through moments later.
  if (tx.status === 'pending' || tx.status === 'initiating' || isResurrectableExpiredDeposit(tx)) {
    try {
      const result = await archpay.checkSTKPushStatus({
        reference: tx.providerReference || tx.reference,
        checkoutRequestId: tx.checkoutRequestId,
        externalReference: tx.reference,
      });

      if (result && result.isSuccess) {
        await settleDepositSuccess(tx, result);
        console.log(`✅ Live check confirmed deposit for ${tx.userId}; reference ${tx.reference}`);
      } else if (result && result.isFailed) {
        await settleDepositFailure(tx, result.reason || 'Payment failed or was cancelled.', 'provider_failed');
        console.warn(`❌ Live check marked deposit failed for ${tx.userId}; reference ${tx.reference}`);
      }
    } catch (e) {
      console.warn('Live STK query error:', e.message);
    }
  }

  const wallet = getWalletRecord(user.id);
  return res.json({
    status: tx.status,
    reason: tx.failureReason || null,
    receiptNumber: tx.mpesaReceiptNumber || null,
    balance: parseFloat(wallet.balance),
    amount: tx.amount,
  });
});

// Player Withdrawal Request Endpoint
app.post('/api/payments/withdraw', async (req, res) => {
  let user = null;
  let wallet = null;
  let currentBalance = 0;
  let tx = null;
  try {
    user = getAuthUser(req);
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { amount, phone } = req.body || {};
    const numericAmount = Number(amount);
    if (!numericAmount || isNaN(numericAmount) || numericAmount < 200) {
      return res.status(400).json({ message: 'Minimum withdrawal is KES 200' });
    }

    wallet = getWalletRecord(user.id);
    currentBalance = parseFloat(wallet.balance || '0');

    if (currentBalance < numericAmount) {
      return res.status(400).json({ message: 'Insufficient wallet balance for withdrawal.' });
    }

    // Money is NOT deducted from player balance - only withdrawal notification is triggered
    const reference = `WDR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    tx = createTransaction('withdrawal', user.id, numericAmount, 'pending', {
      reference,
      phone: normalizePhone(phone) || user.phone,
      paymentMethod: 'mpesa_withdrawal',
    });

    // Save snapshot synchronously and defer DB persistence so withdrawal responds in milliseconds
    void saveStore();

    publishPaymentUpdate(tx);

    // Custom admin popup title and message override if set, else default popup
    const popupTitle = user.withdrawPopupTitleOverride || withdrawalPopupSettings.withdrawPopupTitle || 'Withdrawal Submitted';
    const popupMessage = user.withdrawPopupMessageOverride || withdrawalPopupSettings.withdrawPopupMessage || 'Your withdrawal request has been submitted and is pending admin approval.';

    console.log(`💸 Withdrawal Requested: KES ${numericAmount} by user ${user.username} (${user.id}) [Balance Kept Untouched: KES ${wallet.balance}]`);

    return res.json({
      success: true,
      message: popupMessage,
      transactionId: tx.id,
      reference,
      balance: parseFloat(wallet.balance),
      notification: {
        title: popupTitle,
        message: popupMessage,
        type: 'info'
      },
      popup: {
        title: popupTitle,
        message: popupMessage,
        type: 'info'
      }
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    return res.status(500).json({ message: 'Failed to process withdrawal request' });
  }
});

// Fetch User Transaction History
app.get('/api/payments/transactions', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  const userTxs = transactions
    .filter((t) => t.userId === user.id)
    .map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      status: t.status,
      reference: t.reference || t.mpesaReceiptNumber || '-',
      failure_reason: t.failureReason || null,
      mpesa_receipt_number: t.mpesaReceiptNumber || null,
      created_at: t.createdAt,
    }));

  const userBets = gameState.activeBets.filter((b) => b.odlutUserId === user.id);
  return res.json({ transactions: userTxs, bets: userBets });
});

let withdrawalPopupSettings = {
  withdrawPopupTitle: 'Withdrawal Submitted',
  withdrawPopupMessage: 'Withdrawals are processed instantly via M-Pesa.',
  withdrawPopupEnabled: true,
  withdrawPopupTTL: 6000,
};

// Public settings route for withdrawal popup
app.get('/api/settings', (req, res) => {
  res.json(withdrawalPopupSettings);
});

// Admin withdrawal popup settings
app.get('/api/admin/withdrawal-popup-settings', requireAdmin, (req, res) => {
  res.json(withdrawalPopupSettings);
});

app.patch('/api/admin/withdrawal-popup-settings', requireAdmin, (req, res) => {
  const { withdrawPopupTitle, withdrawPopupMessage, withdrawPopupEnabled, withdrawPopupTTL } = req.body || {};
  if (withdrawPopupTitle !== undefined) withdrawalPopupSettings.withdrawPopupTitle = String(withdrawPopupTitle);
  if (withdrawPopupMessage !== undefined) withdrawalPopupSettings.withdrawPopupMessage = String(withdrawPopupMessage);
  if (withdrawPopupEnabled !== undefined) withdrawalPopupSettings.withdrawPopupEnabled = Boolean(withdrawPopupEnabled);
  if (withdrawPopupTTL !== undefined) withdrawalPopupSettings.withdrawPopupTTL = Number(withdrawPopupTTL);
  // This previously only ever changed in-memory state: the save button
  // reported success, but nothing here was written to MongoDB or the local
  // snapshot, so the change was silently lost on the next restart.
  siteSettings = { ...siteSettings, withdrawalPopupSettings: { ...withdrawalPopupSettings } };
  void saveStore();
  void mongodb.upsertSettings(siteSettings).catch((err) => console.error('Failed to persist withdrawal popup settings:', err.message));
  res.json(withdrawalPopupSettings);
});

// User-specific withdrawal popup override
app.patch('/api/admin/users/:id/withdraw-popup', requireAdmin, (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const { withdrawPopupTitleOverride, withdrawPopupMessageOverride } = req.body || {};
  if (withdrawPopupTitleOverride !== undefined) user.withdrawPopupTitleOverride = withdrawPopupTitleOverride ? String(withdrawPopupTitleOverride) : null;
  if (withdrawPopupMessageOverride !== undefined) user.withdrawPopupMessageOverride = withdrawPopupMessageOverride ? String(withdrawPopupMessageOverride) : null;
  saveStore();
  res.json({ message: 'User popup updated', user });
});

// All transactions endpoint for admin
app.get('/api/admin/transactions', requireAdmin, (req, res) => {
  const adminTxs = transactions
    .filter((t) => t.type === 'deposit')
    .map((t) => {
      const user = getUserById(t.userId);
      return {
        id: t.id,
        userId: t.userId,
        username: user?.username || t.username || 'Player',
        phone: user?.phone || t.phone || '-',
        type: 'deposit',
        amount: Number(t.amount),
        status: t.status || 'pending',
        createdAt: t.createdAt,
        reference: t.reference || t.externalReference || t.checkoutRequestId || '-',
        externalReference: t.externalReference || t.reference || '-',
        // The real Safaricom M-Pesa receipt is only known once the deposit
        // actually completes (see creditCompletedDeposit). `providerReference`
        // is ArchPay's own STK-push tracking reference, set the instant the
        // prompt is sent — showing it here as a fallback used to mask the
        // real receipt for every completed deposit, since it's set well
        // before mpesaReceiptNumber ever is.
        mpesa_receipt_number: t.mpesaReceiptNumber || '-',
        providerFailureReason: t.providerFailureReason || t.failureReason || null,
      };
    });
  res.json({ transactions: adminTxs });
});

// Clear transactions endpoint
app.post('/api/admin/transactions/clear', requireAdmin, async (req, res) => {
  const countBefore = transactions.length;
  transactions.length = 0;
  saveLocalSnapshot();
  // saveStore() alone would upsert this now-empty array, which deletes
  // nothing that was already in MongoDB — the button would report success
  // and clear the on-screen list, but every "cleared" transaction came back
  // on the next restart. Actually delete the collection's contents too.
  void mongodb.deleteAllTransactions().catch((err) => console.error('Failed to delete transactions from MongoDB:', err.message));
  io.emit('admin:transactions:cleared');
  res.json({ message: 'All transactions cleared successfully', clearedCount: countBefore });
});

// Financial summary endpoint
app.get('/api/admin/financial-summary', requireAdmin, (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  let todayDeposits = 0;
  let todayWithdrawals = 0;
  let todayPending = 0;
  let todayFailed = 0;

  transactions.forEach((tx) => {
    const txTime = new Date(tx.createdAt).getTime();
    if (txTime >= startOfDay) {
      const amount = Number(tx.amount) || 0;
      if (tx.type === 'deposit') {
        if (tx.status === 'completed') todayDeposits += amount;
        else if (tx.status === 'pending') todayPending += amount;
        else if (tx.status === 'failed') todayFailed += amount;
      } else if (tx.type === 'withdrawal' && tx.status === 'completed') {
        todayWithdrawals += amount;
      }
    }
  });

  let totalPlayerBalances = 0;
  wallets.forEach((w) => {
    totalPlayerBalances += Number(w.balance) || 0;
  });

  const gameProfit = gameStats.totalWagered - gameStats.totalPayouts;

  res.json({
    today: {
      deposits: todayDeposits,
      withdrawals: todayWithdrawals,
      pending: todayPending,
      failed: todayFailed,
    },
    totalPlayerBalances,
    gameProfit,
    totalWagered: gameStats.totalWagered,
    totalPayouts: gameStats.totalPayouts,
    crashHistory: (gameState.history || []).slice(0, 10),
  });
});

app.delete('/api/admin/transactions', requireAdmin, async (req, res) => {
  const countBefore = transactions.length;
  transactions.length = 0;
  saveLocalSnapshot();
  void mongodb.deleteAllTransactions().catch((err) => console.error('Failed to delete transactions from MongoDB:', err.message));
  io.emit('admin:transactions:cleared');
  res.json({ message: 'All transactions cleared successfully', clearedCount: countBefore });
});

// Approve pending transaction
app.post('/api/admin/transactions/:id/approve', requireAdmin, async (req, res) => {
  const tx = transactions.find((t) => t.id === req.params.id);
  if (!tx) return res.status(404).json({ message: 'Transaction not found' });
  if (tx.status === 'completed') return res.status(400).json({ message: 'Transaction already completed' });

  tx.status = 'completed';
  tx.updatedAt = new Date().toISOString();

  if (tx.type === 'deposit') {
    const wallet = getWalletRecord(tx.userId);
    wallet.balance = (parseFloat(wallet.balance) + Number(tx.amount)).toFixed(2);
    wallet.depositCount = (wallet.depositCount || 0) + 1;
    wallet.totalDeposited = (wallet.totalDeposited || 0) + Number(tx.amount);
    wallets.set(tx.userId, wallet);
    io.to(tx.userId).emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });
    io.to(tx.userId).emit('deposit:success', { amount: tx.amount, balance: wallet.balance });
  }

  await saveStore();
  publishPaymentUpdate(tx);
  res.json({ message: 'Transaction approved', transaction: tx });
});

// Reject pending transaction
app.post('/api/admin/transactions/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body || {};
  const tx = transactions.find((t) => t.id === req.params.id);
  if (!tx) return res.status(404).json({ message: 'Transaction not found' });

  tx.status = 'failed';
  tx.failureReason = reason || 'Rejected by admin';
  tx.updatedAt = new Date().toISOString();

  void saveStore();
  publishPaymentUpdate(tx);
  res.json({ message: 'Transaction rejected', transaction: tx });
});

// Manually ask ArchPay right now for a deposit's live status, instead of
// waiting on the background pollers. Unlike /approve (which force-credits a
// transaction on the admin's say-so with no provider verification), this
// only ever changes the transaction based on what ArchPay itself reports —
// safe to use whenever a payment looks stuck and you don't want to wait out
// the automatic retry window.
app.post('/api/admin/transactions/:id/recheck', requireAdmin, async (req, res) => {
  const tx = transactions.find((t) => t.id === req.params.id && isMpesaDeposit(t));
  if (!tx) return res.status(404).json({ message: 'ArchPay deposit not found' });

  if (tx.status === 'completed') {
    return res.json({ message: 'This deposit is already completed.', transaction: tx });
  }
  if (tx.status === 'failed' && tx.failureKind !== 'expired') {
    return res.status(400).json({ message: 'ArchPay already gave a final failure for this deposit; there is nothing new to check.', transaction: tx });
  }

  try {
    const result = await archpay.checkSTKPushStatus({
      reference: tx.providerReference || tx.reference,
      checkoutRequestId: tx.checkoutRequestId,
      externalReference: tx.reference,
    });

    if (result && result.isSuccess) {
      await settleDepositSuccess(tx, result);
      console.log(`✅ Deposit recovered via manual admin recheck for ${tx.userId}; reference ${tx.reference}`);
      return res.json({ message: 'ArchPay confirmed this payment succeeded. The wallet has been credited.', transaction: tx });
    }
    if (result && result.isFailed) {
      await settleDepositFailure(tx, result.reason || 'Payment failed or was cancelled.', 'provider_failed');
      return res.json({ message: 'ArchPay confirmed this payment failed.', transaction: tx });
    }
    return res.json({ message: 'ArchPay still has no final result for this payment yet (still queued on their side).', transaction: tx });
  } catch (err) {
    console.error('Manual admin recheck error:', err.message);
    return res.status(502).json({ message: 'Could not reach ArchPay to recheck this payment. Try again shortly.' });
  }
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const onlineUsers = new Set(
    Array.from(io.sockets.sockets.values()).map((socket) => socket.odlutUserId).filter(Boolean)
  );
  res.json({ ...gameStats, connectedClients: onlineUsers.size, currentPhase: gameState.phase, currentMultiplier: gameState.multiplier, roundNumber: gameState.roundNumber });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = (req.query.search || '').toLowerCase();
  let allUsers = Array.from(users.values()).filter(u => !u.id?.startsWith('bot-') && u.phone).map(u => ({
    id: u.id, username: u.username, email: u.email,
    phone: u.phone || null,
    balance: wallets.get(u.id)?.balance || '0.00',
    depositCount: wallets.get(u.id)?.depositCount || 0,
    totalDeposited: wallets.get(u.id)?.totalDeposited || 0,
    role: u.role, isActive: u.isActive !== false,
    createdAt: u.createdAt || new Date().toISOString()
  }));
  if (search) {
    allUsers = allUsers.filter(u =>
      u.username.toLowerCase().includes(search) ||
      u.email.toLowerCase().includes(search) ||
      String(u.phone || '').toLowerCase().includes(search)
    );
  }
  allUsers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ users: allUsers.slice((page - 1) * limit, page * limit), total: allUsers.length, page, limit });
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const creator = getAuthUser(req);
    const { username, email, password, phone, role } = req.body || {};
    const pwd = (password || '').toString();
    if (pwd.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return res.status(400).json({ message: 'Phone is required' });

    const hasPhone = Array.from(users.values()).some((u) => normalizePhone(u.phone) === normalizedPhone);
    if (hasPhone) return res.status(409).json({ message: 'Phone already registered' });

    const normalizedEmail = (email || `${normalizedPhone}@betzion.local`).toString().trim().toLowerCase();
    const hasEmail = Array.from(users.values()).some((u) => (u.email || '').toLowerCase() === normalizedEmail);
    if (hasEmail) return res.status(409).json({ message: 'Email already registered' });

    const safeUsername = (username || '').toString().trim() || `User${normalizedPhone.slice(-4)}`;
    const userId = `user-${Date.now()}`;

    // Only SUPER_ADMIN can assign ADMIN role
    let assignedRole = (role || 'user').toString().toUpperCase();
    if (assignedRole === 'ADMIN' && creator?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only Superadmin can create Admin accounts' });
    }

    const user = {
      id: userId,
      username: safeUsername,
      fullName: safeUsername,
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash: await bcrypt.hash(pwd, 10),
      role: assignedRole === 'ADMIN' ? 'ADMIN' : 'user',
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    users.set(userId, user);
    wallets.set(userId, normalizeWallet({ balance: '0.00', depositCount: 0 }));
    saveStore();

    return res.status(201).json({ message: 'User created successfully', user });
  } catch (e) {
    return res.status(500).json({ message: 'Error creating user' });
  }
});

app.patch('/api/admin/users/:id/balance', requireAdmin, (req, res) => {
  const { delta, setTo } = req.body;
  const wallet = getWalletRecord(req.params.id);
  if (!wallet) return res.status(404).json({ message: 'Not found' });
  if (setTo !== undefined) wallet.balance = parseFloat(setTo).toFixed(2);
  else if (delta !== undefined) wallet.balance = (parseFloat(wallet.balance) + delta).toFixed(2);
  if (parseFloat(wallet.balance) > 0 && wallet.depositCount === 0) {
    wallet.depositCount = 1;
  }
  wallets.set(req.params.id, wallet);
  void saveStore();
  io.to(req.params.id).emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });
  res.json(wallet);
});

app.patch('/api/admin/users/:id/deactivate', requireAdmin, (req, res) => {
  for (const user of users.values()) {
    if (user.id === req.params.id) {
      user.isActive = false;
      saveStore();
      return res.json({ message: 'OK' });
    }
  }
  res.status(404).json({ message: 'Not found' });
});

app.patch('/api/admin/users/:id/activate', requireAdmin, (req, res) => {
  for (const user of users.values()) {
    if (user.id === req.params.id) {
      user.isActive = true;
      saveStore();
      return res.json({ message: 'OK' });
    }
  }
  res.status(404).json({ message: 'Not found' });
});


// Promote user to admin (SUPER_ADMIN only)
app.patch('/api/admin/users/:id/promote', requireAdmin, (req, res) => {
  const admin = getAuthUser(req);
  if (admin.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Super admin required' });
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.role === 'SUPER_ADMIN') return res.status(400).json({ message: 'Cannot modify super admin' });
  user.role = 'ADMIN';
  saveStore();
  res.json({ message: 'User promoted to admin' });
});

// Demote admin to user (SUPER_ADMIN only)
app.patch('/api/admin/users/:id/demote', requireAdmin, (req, res) => {
  const admin = getAuthUser(req);
  if (admin.role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Super admin required' });
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.role === 'SUPER_ADMIN') return res.status(400).json({ message: 'Cannot demote super admin' });
  user.role = 'USER';
  saveStore();
  res.json({ message: 'Admin demoted to user' });
});
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(gameSettings));
app.patch('/api/admin/settings', requireAdmin, updateGameSettings);

app.post('/api/admin/users/:id/bonus', requireAdmin, (req, res) => {
  const { amount } = req.body;
  const wallet = getWalletRecord(req.params.id);
  if (!wallet || !amount || amount <= 0) return res.status(400).json({ message: 'Invalid' });
  wallet.balance = (parseFloat(wallet.balance) + Number(amount)).toFixed(2);
  if (parseFloat(wallet.balance) > 0 && wallet.depositCount === 0) {
    wallet.depositCount = 1;
  }
  wallets.set(req.params.id, wallet);
  void saveStore();
  io.to(req.params.id).emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });
  res.json({ message: 'OK', balance: wallet.balance });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: 'v2026.08.22.auth_startup_ready', uptime: process.uptime() }));


// Admin password reset endpoint
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  user.passwordHash = await bcrypt.hash(password, 10);
  saveStore();
  res.json({ message: 'Password reset successfully' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PREDATOR: ONE ROUND AHEAD
// ═══════════════════════════════════════════════════════════════════════════════

// The engine used to invent a round's crash point at the moment betting opened,
// which left nothing to publish about the round after it. The Predator now
// draws that number a round early and holds it here; the engine takes it when
// the round opens, so what a subscriber saw is what the round resolves at.
const predatorNextCrash = new Map();

// The Predator reads the same room the board has always read, room 1.
const PREDATOR_ROOM_ID = 1;

/** The armed admin override for a room, without consuming it. */
function peekNextCrashOverride(roomId) {
  return nextCrashOverrides.has(roomId) ? nextCrashOverrides.get(roomId) : null;
}

/**
 * The crash point the next round of this room will open on, drawing it now if
 * it has not been drawn yet. An armed admin override is reported instead, so
 * the board never promises a figure the administrator has already overruled.
 */
function getUpcomingCrashPoint(roomId) {
  const armed = peekNextCrashOverride(roomId);
  if (armed !== null) return armed;
  if (!predatorNextCrash.has(roomId)) {
    predatorNextCrash.set(roomId, generateCrashPoint());
  }
  return predatorNextCrash.get(roomId);
}

/** Hands the held figure to the engine and clears it for the round after. */
function takePredatorCrashPoint(roomId) {
  const value = predatorNextCrash.has(roomId)
    ? predatorNextCrash.get(roomId)
    : generateCrashPoint();
  predatorNextCrash.delete(roomId);
  return value;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREDATOR ACCESS TOKENS
// ═══════════════════════════════════════════════════════════════════════════════

// Ambiguous glyphs are left out so a code read off a screen and typed into a
// phone cannot be confused: no O/0, no I/1, no lookalike pairs.
const PREDATOR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREDATOR_MAX_DURATION_HOURS = 24 * 365;
// The predictor that runs against this platform's own engine. It is the only
// site whose signals this server can serve, so it can be renamed or repriced
// but never deleted.
const BETZION_SITE_ID = 'betzion';

function makeSiteId(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || `site-${crypto.randomInt(100000, 999999)}`;
}

// The catalogue an operator starts with. Every one of these is switched off
// until an administrator prices it and turns it on, so nothing is offered for
// sale before it can be delivered. Names, prices, logos and availability are
// all editable afterwards, and sites can be added or removed.
// Logo paths point at the files in public/assets. Spaces are percent-encoded
// so the browser requests them verbatim.
const DEFAULT_PREDICTOR_SITES = [
  { id: 'betika', name: 'Betika', accent: '#0072bc', logoUrl: '/assets/images/betika%20logo.jpeg', description: 'Next-crash signals for Betika Aviator.' },
  { id: 'sportpesa', name: 'SportPesa', accent: '#016f3a', logoUrl: '/assets/images/sportpesa.jpeg', description: 'Next-crash signals for SportPesa Aviator.' },
  { id: 'sportybet', name: 'SportyBet', accent: '#d7262b', logoUrl: '/assets/images/sportybet%20logo.jpeg', description: 'Next-crash signals for SportyBet Aviator.' },
  { id: 'odibets', name: 'Odibets', accent: '#00a651', logoUrl: '/assets/images/odibets%20logo.jpeg', description: 'Next-crash signals for Odibets Aviator.' },
  { id: '1xbet', name: '1xBet', accent: '#1a6dc4', logoUrl: '/assets/images/1xbet%20logo.jpeg', description: 'Next-crash signals for 1xBet Aviator.' },
  { id: 'mozzartbet', name: 'Mozzart Bet', accent: '#f5a300', logoUrl: '/assets/images/Mozzartbet%20logo.jpeg', description: 'Next-crash signals for Mozzart Bet Aviator.' },
  { id: 'betway', name: 'Betway', accent: '#00a826', logoUrl: '/assets/images/betway%20logo.jpeg', description: 'Next-crash signals for Betway Aviator.' },
];

// Bumped whenever the shipped list changes, so an existing catalogue is
// reconciled once rather than on every boot.
const PREDATOR_CATALOGUE_VERSION = 2;

function makePredatorSite(fields) {
  const now = new Date().toISOString();
  return {
    id: fields.id || makeSiteId(fields.name),
    name: fields.name,
    description: fields.description || '',
    // A logo image the administrator can point at any hosted file. Left blank,
    // the player screen draws an initials badge in the site's accent colour,
    // so the catalogue looks finished without shipping anyone's artwork.
    logoUrl: fields.logoUrl || '',
    accent: fields.accent || '#ff0058',
    priceKes: Number.isFinite(Number(fields.priceKes)) ? Math.round(Number(fields.priceKes)) : 500,
    durationHours: Number(fields.durationHours) || 24,
    available: fields.available === true,
    builtIn: fields.builtIn === true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Guarantees the built-in Betzion entry exists and, on a catalogue that has
 * never been set up, lays out the starter list for the administrator to price.
 */
function ensurePredatorSites() {
  if (!Array.isArray(predatorSites)) predatorSites = [];

  if (!predatorSites.some((site) => site.id === BETZION_SITE_ID)) {
    predatorSites.unshift(makePredatorSite({
      id: BETZION_SITE_ID,
      name: 'Betzion',
      description: 'Engine-locked crash point for the live Betzion round.',
      logoUrl: '/assets/icons/betzion-app-icon.svg',
      accent: '#ffd700',
      priceKes: 500,
      durationHours: 24,
      available: true,
      builtIn: true,
    }));
  }

  // Reconcile against the shipped list once per catalogue version: add any
  // site that is missing and refresh the artwork, while leaving every price,
  // duration and availability switch the administrator has set alone.
  if (siteSettings.predatorCatalogueVersion !== PREDATOR_CATALOGUE_VERSION) {
    for (const preset of DEFAULT_PREDICTOR_SITES) {
      const existing = predatorSites.find((site) => site.id === preset.id);
      if (existing) {
        existing.name = preset.name;
        existing.logoUrl = preset.logoUrl;
        existing.accent = preset.accent;
        if (!existing.description) existing.description = preset.description;
      } else {
        predatorSites.push(makePredatorSite({ ...preset, priceKes: 500, durationHours: 24, available: false }));
      }
    }

    const betzion = predatorSites.find((site) => site.id === BETZION_SITE_ID);
    if (betzion) {
      betzion.name = 'Betzion';
      betzion.logoUrl = '/assets/icons/betzion-app-icon.svg';
      betzion.accent = '#ffd700';
    }

    // Drop earlier presets that are no longer shipped, unless a player paid
    // for one — their access is honoured until it lapses.
    const shipped = new Set([BETZION_SITE_ID, ...DEFAULT_PREDICTOR_SITES.map((preset) => preset.id)]);
    const retired = ['22bet-aviator', 'bangbet-aviator', 'odibets-aviator', 'betika-aviator', 'sportpesa-aviator', '1xbet-aviator', 'mozzart-aviator', 'betway-aviator'];
    predatorSites = predatorSites.filter((site) => {
      if (shipped.has(site.id) || !retired.includes(site.id)) return true;
      return predatorSubscriptions.some(
        (entry) => entry.siteId === site.id && subscriptionStatus(entry) === 'active'
      );
    });

    siteSettings = { ...siteSettings, predatorCatalogueVersion: PREDATOR_CATALOGUE_VERSION, predatorCatalogueSeeded: true };
    void persistPredatorTokens();
  }

  // Older records predate these fields; fill them in so the UI never renders
  // an undefined colour or logo.
  for (const site of predatorSites) {
    if (typeof site.logoUrl !== 'string') site.logoUrl = '';
    if (!site.accent) site.accent = '#ff0058';
  }

  return predatorSites;
}

function findPredatorSite(siteId) {
  const wanted = String(siteId || '').trim().toLowerCase();
  return ensurePredatorSites().find((site) => site.id === wanted) || null;
}

function subscriptionStatus(subscription) {
  if (!subscription) return 'missing';
  if (subscription.revokedAt) return 'revoked';
  return new Date(subscription.expiresAt).getTime() > Date.now() ? 'active' : 'expired';
}

/**
 * The live grant for one player on one site, whichever of a redeemed token or
 * a paid subscription runs longest. Null when they hold neither.
 */
function getSiteGrant(userId, siteId) {
  if (!userId) return null;
  const fromTokens = predatorTokens
    .filter((token) => token.redeemedBy === userId
      && (token.siteId || BETZION_SITE_ID) === siteId
      && predatorTokenStatus(token) === 'active')
    .map((token) => ({ expiresAt: token.expiresAt, source: 'token', code: token.code }));
  const fromPurchases = predatorSubscriptions
    .filter((entry) => entry.userId === userId && entry.siteId === siteId && subscriptionStatus(entry) === 'active')
    .map((entry) => ({ expiresAt: entry.expiresAt, source: 'purchase', code: null }));

  const all = [...fromTokens, ...fromPurchases];
  if (!all.length) return null;
  return all.reduce((longest, grant) =>
    new Date(grant.expiresAt).getTime() > new Date(longest.expiresAt).getTime() ? grant : longest
  );
}

/** When a new window should start: after any time the player still has left. */
function grantStartPoint(userId, siteId) {
  const existing = getSiteGrant(userId, siteId);
  return existing ? Math.max(Date.now(), new Date(existing.expiresAt).getTime()) : Date.now();
}

function publicPredatorSite(site, user) {
  const grant = isAdminUser(user) ? null : getSiteGrant(user?.id, site.id);
  return {
    id: site.id,
    name: site.name,
    description: site.description || '',
    logoUrl: site.logoUrl || '',
    accent: site.accent || '#ff0058',
    priceKes: Number(site.priceKes) || 0,
    durationHours: Number(site.durationHours) || 24,
    available: Boolean(site.available),
    builtIn: Boolean(site.builtIn),
    unlocked: isAdminUser(user) ? true : Boolean(grant),
    expiresAt: grant ? grant.expiresAt : null,
    source: isAdminUser(user) ? 'admin' : (grant ? grant.source : null),
  };
}

function generatePredatorCode() {
  const block = () => Array.from(
    { length: 4 },
    () => PREDATOR_CODE_ALPHABET[crypto.randomInt(PREDATOR_CODE_ALPHABET.length)]
  ).join('');
  return `PRD-${block()}-${block()}`;
}

function normalizePredatorCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function findPredatorToken(code) {
  const normalized = normalizePredatorCode(code);
  if (!normalized) return null;
  return predatorTokens.find((token) => normalizePredatorCode(token.code) === normalized) || null;
}

/**
 * Current state of a token, derived rather than stored, so a subscription
 * lapses on its own without a sweep job having to run.
 */
function predatorTokenStatus(token) {
  if (!token) return 'missing';
  if (token.revokedAt) return 'revoked';
  if (!token.redeemedBy) return 'unused';
  return new Date(token.expiresAt).getTime() > Date.now() ? 'active' : 'expired';
}

/**
 * Administrators read the engine as part of running the platform and are never
 * asked to pay or redeem; every other account needs a live grant on the
 * Betzion site, bought or redeemed.
 */
function getPredatorAccess(user) {
  if (isAdminUser(user)) {
    return { unlocked: true, isAdmin: true, expiresAt: null, code: null, source: 'admin' };
  }
  const grant = getSiteGrant(user?.id, BETZION_SITE_ID);
  return {
    unlocked: Boolean(grant),
    isAdmin: false,
    expiresAt: grant ? grant.expiresAt : null,
    code: grant ? grant.code : null,
    source: grant ? grant.source : null,
  };
}

function publicPredatorToken(token) {
  const holder = token.redeemedBy ? getUserById(token.redeemedBy) : null;
  return {
    code: token.code,
    siteId: token.siteId || BETZION_SITE_ID,
    siteName: token.siteName || (findPredatorSite(token.siteId || BETZION_SITE_ID)?.name || 'Betzion Aviator'),
    status: predatorTokenStatus(token),
    durationHours: token.durationHours,
    note: token.note || '',
    createdAt: token.createdAt,
    createdByName: token.createdByName || '',
    redeemedBy: token.redeemedBy || null,
    redeemedByName: holder ? (holder.username || holder.phone || token.redeemedBy) : (token.redeemedByName || ''),
    redeemedAt: token.redeemedAt || null,
    expiresAt: token.expiresAt || null,
    revokedAt: token.revokedAt || null,
  };
}

async function persistPredatorTokens() {
  siteSettings = { ...siteSettings, predatorTokens, predatorSites, predatorSubscriptions };
  try {
    await Promise.all([saveStore(), mongodb.upsertSettings(siteSettings)]);
  } catch (error) {
    console.warn('Failed to persist Predator tokens:', error?.message || error);
  }
}

// Admin: mint one or more codes to hand out.
app.post('/api/admin/predator/tokens', requireAdmin, async (req, res) => {
  const admin = getAuthUser(req);
  const { durationHours, count, note, siteId } = req.body || {};

  const site = findPredatorSite(siteId || BETZION_SITE_ID);
  if (!site) return res.status(400).json({ message: 'Unknown predictor site.' });

  const hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > PREDATOR_MAX_DURATION_HOURS) {
    return res.status(400).json({ message: 'Duration must be between 1 hour and 1 year.' });
  }
  const howMany = Math.min(Math.max(Math.trunc(Number(count) || 1), 1), 50);

  const created = [];
  for (let index = 0; index < howMany; index += 1) {
    let code = generatePredatorCode();
    while (findPredatorToken(code)) code = generatePredatorCode();
    const token = {
      code,
      siteId: site.id,
      siteName: site.name,
      durationHours: hours,
      note: String(note || '').slice(0, 120),
      createdAt: new Date().toISOString(),
      createdBy: admin?.id || null,
      createdByName: admin?.username || '',
      redeemedBy: null,
      redeemedByName: '',
      redeemedAt: null,
      expiresAt: null,
      revokedAt: null,
    };
    predatorTokens.unshift(token);
    created.push(token);
  }

  await persistPredatorTokens();
  return res.status(201).json({
    message: `Generated ${created.length} token${created.length === 1 ? '' : 's'}.`,
    tokens: created.map(publicPredatorToken),
  });
});

// Admin: the full ledger of who holds what.
app.get('/api/admin/predator/tokens', requireAdmin, (req, res) => {
  const tokens = predatorTokens.map(publicPredatorToken);
  const paid = predatorSubscriptions.filter((entry) => subscriptionStatus(entry) === 'active');
  return res.json({
    tokens,
    // Predictor takings do not appear on the transactions screen, which lists
    // deposits only, so the totals are reported here instead.
    subscriptions: predatorSubscriptions.map((entry) => ({
      id: entry.id,
      userName: entry.userName || entry.userId,
      siteName: entry.siteName,
      amountPaid: entry.amountPaid,
      startedAt: entry.startedAt,
      expiresAt: entry.expiresAt,
      status: subscriptionStatus(entry),
    })),
    summary: {
      total: tokens.length,
      unused: tokens.filter((token) => token.status === 'unused').length,
      active: tokens.filter((token) => token.status === 'active').length + paid.length,
      expired: tokens.filter((token) => token.status === 'expired').length,
      revoked: tokens.filter((token) => token.status === 'revoked').length,
      paidActive: paid.length,
      revenueKes: predatorSubscriptions.reduce((sum, entry) => sum + (Number(entry.amountPaid) || 0), 0),
    },
  });
});

// Admin: cut off access immediately, whether or not the code was redeemed.
app.post('/api/admin/predator/tokens/:code/revoke', requireAdmin, async (req, res) => {
  const token = findPredatorToken(req.params.code);
  if (!token) return res.status(404).json({ message: 'Token not found.' });
  if (token.revokedAt) return res.status(409).json({ message: 'Token is already revoked.' });

  token.revokedAt = new Date().toISOString();
  await persistPredatorTokens();
  return res.json({ message: 'Token revoked.', token: publicPredatorToken(token) });
});

// Admin: remove a code from the ledger entirely.
app.delete('/api/admin/predator/tokens/:code', requireAdmin, async (req, res) => {
  const token = findPredatorToken(req.params.code);
  if (!token) return res.status(404).json({ message: 'Token not found.' });
  predatorTokens = predatorTokens.filter((entry) => entry !== token);
  await persistPredatorTokens();
  return res.json({ message: 'Token deleted.' });
});

// Admin: the predictor catalogue, prices and availability.
app.get('/api/admin/predator/sites', requireAdmin, (req, res) => {
  return res.json({ sites: ensurePredatorSites() });
});

// Admin: add another site to sell signals for.
app.post('/api/admin/predator/sites', requireAdmin, async (req, res) => {
  const { name, description, priceKes, durationHours, available, logoUrl, accent } = req.body || {};
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return res.status(400).json({ message: 'A site name is required.' });

  const price = Number(priceKes);
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ message: 'Price must be zero or more.' });
  }
  const hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > PREDATOR_MAX_DURATION_HOURS) {
    return res.status(400).json({ message: 'Duration must be between 1 hour and 1 year.' });
  }

  ensurePredatorSites();
  let id = makeSiteId(trimmedName);
  while (predatorSites.some((site) => site.id === id)) id = `${makeSiteId(trimmedName)}-${crypto.randomInt(10, 99)}`;

  const site = makePredatorSite({
    id,
    name: trimmedName.slice(0, 60),
    description: String(description || '').slice(0, 160),
    logoUrl: String(logoUrl || '').slice(0, 400),
    accent: String(accent || '').slice(0, 20) || '#ff0058',
    priceKes: Math.round(price),
    durationHours: hours,
    // New sites start unavailable so a price can be set and checked before
    // players are offered something that cannot be delivered yet.
    available: available === true,
    builtIn: false,
  });
  predatorSites.push(site);
  await persistPredatorTokens();
  return res.status(201).json({ message: `${site.name} added.`, site });
});

// Admin: reprice, rename, or switch a site on and off.
app.patch('/api/admin/predator/sites/:id', requireAdmin, async (req, res) => {
  const site = findPredatorSite(req.params.id);
  if (!site) return res.status(404).json({ message: 'Site not found.' });

  const { name, description, priceKes, durationHours, available, logoUrl, accent } = req.body || {};

  if (logoUrl !== undefined) site.logoUrl = String(logoUrl).slice(0, 400);
  if (accent !== undefined) site.accent = String(accent).slice(0, 20) || '#ff0058';
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ message: 'A site name is required.' });
    site.name = trimmed.slice(0, 60);
  }
  if (description !== undefined) site.description = String(description).slice(0, 160);
  if (priceKes !== undefined) {
    const price = Number(priceKes);
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: 'Price must be zero or more.' });
    site.priceKes = Math.round(price);
  }
  if (durationHours !== undefined) {
    const hours = Number(durationHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > PREDATOR_MAX_DURATION_HOURS) {
      return res.status(400).json({ message: 'Duration must be between 1 hour and 1 year.' });
    }
    site.durationHours = hours;
  }
  if (available !== undefined) site.available = Boolean(available);
  site.updatedAt = new Date().toISOString();

  await persistPredatorTokens();
  return res.json({ message: `${site.name} updated.`, site });
});

// Admin: remove an added site. Betzion stays, since its signals come from this
// server's own engine and players may hold live subscriptions to it.
app.delete('/api/admin/predator/sites/:id', requireAdmin, async (req, res) => {
  const site = findPredatorSite(req.params.id);
  if (!site) return res.status(404).json({ message: 'Site not found.' });
  if (site.builtIn) return res.status(400).json({ message: 'The Betzion predictor cannot be removed. Switch it off instead.' });

  const liveHolders = predatorSubscriptions.filter(
    (entry) => entry.siteId === site.id && subscriptionStatus(entry) === 'active'
  ).length;
  if (liveHolders > 0 && req.query.force !== 'true') {
    return res.status(409).json({
      message: `${liveHolders} player${liveHolders === 1 ? '' : 's'} still hold a paid subscription to ${site.name}. Switch it off instead, or repeat with force=true.`,
    });
  }

  predatorSites = predatorSites.filter((entry) => entry.id !== site.id);
  await persistPredatorTokens();
  return res.json({ message: `${site.name} removed.` });
});

// Player: the catalogue as this account sees it, with prices and what they hold.
app.get('/api/predator/sites', requireAuth, (req, res) => {
  const user = getAuthUser(req);
  const wallet = getWalletRecord(user.id);
  return res.json({
    balance: Number(parseFloat(wallet.balance) || 0),
    sites: ensurePredatorSites().map((site) => publicPredatorSite(site, user)),
  });
});

// Player: buy a subscription with wallet balance.
app.post('/api/predator/subscribe', requireAuth, async (req, res) => {
  const user = getAuthUser(req);
  if (isAdminUser(user)) {
    return res.status(400).json({ message: 'Administrator accounts already have Predator access — no purchase needed.' });
  }

  const site = findPredatorSite(req.body?.siteId);
  if (!site) return res.status(404).json({ message: 'Unknown predictor site.' });
  if (!site.available) {
    return res.status(403).json({ message: `${site.name} signals are not on sale yet. Check back soon.` });
  }

  const price = Math.round(Number(site.priceKes) || 0);
  const wallet = getWalletRecord(user.id);
  const balance = Number(parseFloat(wallet.balance) || 0);
  if (balance < price) {
    return res.status(402).json({
      message: `You need KES ${price} in your wallet to subscribe. Your balance is KES ${balance.toFixed(2)}.`,
      required: price,
      balance,
    });
  }

  // Charge the wallet the same way every other balance movement in this file
  // does — adjust the record, write a transaction, tell the open socket. The
  // M-Pesa deposit flow is not involved: this spends money already on account.
  wallet.balance = (balance - price).toFixed(2);
  wallets.set(user.id, wallet);

  const startFrom = grantStartPoint(user.id, site.id);
  const subscription = {
    id: `psub-${Date.now()}-${crypto.randomInt(100000, 999999)}`,
    userId: user.id,
    userName: user.username || user.phone || '',
    siteId: site.id,
    siteName: site.name,
    amountPaid: price,
    durationHours: site.durationHours,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(startFrom + site.durationHours * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
  };
  predatorSubscriptions.unshift(subscription);

  createTransaction('predator_subscription', user.id, price, 'completed', {
    channel: 'predator',
    siteId: site.id,
    siteName: site.name,
    reference: subscription.id,
  });
  await persistPredatorTokens();

  io.to(user.id).emit('wallet:update', { balance: wallet.balance, depositCount: wallet.depositCount });

  return res.json({
    message: `${site.name} signals unlocked.`,
    balance: Number(wallet.balance),
    subscription: { siteId: site.id, expiresAt: subscription.expiresAt },
    access: getPredatorAccess(user),
    sites: ensurePredatorSites().map((entry) => publicPredatorSite(entry, user)),
  });
});

// Player: what the subscribe screen needs to decide what to show.
app.get('/api/predator/access', requireAuth, (req, res) => {
  const user = getAuthUser(req);
  return res.json(getPredatorAccess(user));
});

// Player: exchange a code from the administrator for a subscription window.
app.post('/api/predator/redeem', requireAuth, async (req, res) => {
  const user = getAuthUser(req);
  // Administrators already see the engine, so a code spent on one would be
  // burned for nothing. Tell them plainly instead of consuming it.
  if (isAdminUser(user)) {
    return res.status(400).json({ message: 'Administrator accounts already have Predator access — no token needed.' });
  }

  const token = findPredatorToken(req.body?.code);
  const status = predatorTokenStatus(token);

  if (!token) return res.status(404).json({ message: 'That token was not recognised. Check the code and try again.' });
  if (status === 'revoked') return res.status(403).json({ message: 'This token has been cancelled by the administrator.' });
  if (status === 'expired') return res.status(403).json({ message: 'This token has already run out.' });
  if (token.redeemedBy && token.redeemedBy !== user.id) {
    return res.status(409).json({ message: 'This token has already been used by another player.' });
  }
  if (token.redeemedBy === user.id) {
    return res.json({ message: 'This token is already active on your account.', access: getPredatorAccess(user) });
  }

  // An unused code starts its window now. A player who already holds a live
  // grant on that site stacks the new window on top of the remaining time.
  const startFrom = grantStartPoint(user.id, token.siteId || BETZION_SITE_ID);
  token.redeemedBy = user.id;
  token.redeemedByName = user.username || user.phone || '';
  token.redeemedAt = new Date().toISOString();
  token.expiresAt = new Date(startFrom + token.durationHours * 60 * 60 * 1000).toISOString();

  await persistPredatorTokens();
  return res.json({
    message: 'Predator unlocked. Your signals are live.',
    access: getPredatorAccess(user),
  });
});

app.get('/api/predator', requireAuth, (req, res) => {
  const access = getPredatorAccess(getAuthUser(req));
  const history = (gameState.history || []).slice(0, 60);
  const currentPhase = gameState.phase || 'idle';

  // Locked visitors get the subscribe screen's backdrop — the live phase and
  // the crash history, both of which they can already watch on the game — and
  // nothing that reveals where the current round will end.
  if (!access.unlocked) {
    return res.json({
      access,
      locked: true,
      currentState: {
        phase: currentPhase,
        currentMultiplier: Number.isFinite(Number(gameState.multiplier)) ? Number(gameState.multiplier) : 1,
        crashPoint: null,
        history,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // The board always names the next round a player can still bet on. While
  // betting is open that is this round, so the figure a subscriber was shown a
  // moment ago stays on screen instead of jumping as the round opens. At every
  // other point it is the round after, drawn ahead and held for the engine.
  const bettingOpen = currentPhase === 'betting';
  const signalCrashPoint = bettingOpen
    ? Number(gameState.crashPoint)
    : getUpcomingCrashPoint(PREDATOR_ROOM_ID);
  const signalRound = bettingOpen ? gameState.roundNumber : gameState.roundNumber + 1;
  const lockedCrashPoint = Number.isFinite(Number(signalCrashPoint)) ? Number(signalCrashPoint) : null;

  res.json({
    access,
    locked: false,
    decision: {
      roundNumber: signalRound,
      lockedCrashPoint,
      lockedAt: gameState.bettingStartedAt ? new Date(gameState.bettingStartedAt).toISOString() : null,
      status: lockedCrashPoint !== null ? 'locked' : 'pending',
      phase: currentPhase,
      note: bettingOpen
        ? 'Betting is open on this round and it will resolve at this point.'
        : 'This is the crash point the next round will open on.',
    },
    prediction: {
      roundNumber: signalRound,
      predictedCrashPoint: lockedCrashPoint !== null ? lockedCrashPoint : 1.5,
      confidence: 'engine-locked',
      trend: 'neutral',
      basedOn: 'Direct engine decision, drawn before the round opens.',
      recommendation: bettingOpen
        ? 'Betting is open on this round.'
        : 'This figure belongs to the next round.',
    },
    currentState: {
      phase: currentPhase,
      currentMultiplier: Number.isFinite(Number(gameState.multiplier)) ? Number(gameState.multiplier) : 1,
      crashPoint: lockedCrashPoint,
      history,
    },
    timestamp: new Date().toISOString(),
  });
});

// Read what is currently armed for the next round of each room.
app.get('/api/admin/next-crash', requireAdmin, (req, res) => {
  res.json(nextCrashOverridePayload());
});

// Arm a crash point for the next round of a room. It applies to the next
// round that opens, not the round already in progress, because a round's
// crash point is decided the moment its betting phase starts.
app.post('/api/admin/next-crash', requireAdmin, (req, res) => {
  const { roomId, crashPoint } = req.body || {};
  const targetRoom = normalizeRoomId(roomId === undefined ? 1 : roomId);
  if (targetRoom === null) {
    return res.status(400).json({ message: 'Choose a valid room.' });
  }

  const value = Number(crashPoint);
  if (!Number.isFinite(value) || value < MIN_CRASH_OVERRIDE || value > MAX_CRASH_OVERRIDE) {
    return res.status(400).json({ message: `Crash point must be a number between ${MIN_CRASH_OVERRIDE.toFixed(2)} and ${MAX_CRASH_OVERRIDE}.` });
  }

  const rounded = Math.floor(value * 100) / 100;
  setNextCrashOverride(targetRoom, rounded);
  publishNextCrashOverride();
  console.log(`Admin armed next crash point ${rounded}x for room ${targetRoom}`);
  return res.json({
    message: `Next round in room ${targetRoom} will crash at ${rounded.toFixed(2)}x.`,
    ...nextCrashOverridePayload(),
  });
});

// Drop an armed crash point so the room goes back to the default engine value.
app.delete('/api/admin/next-crash/:roomId', requireAdmin, (req, res) => {
  const targetRoom = normalizeRoomId(req.params.roomId);
  if (targetRoom === null) {
    return res.status(400).json({ message: 'Choose a valid room.' });
  }
  clearNextCrashOverride(targetRoom);
  publishNextCrashOverride();
  return res.json({
    message: `Room ${targetRoom} is back to the default crash point.`,
    ...nextCrashOverridePayload(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/leaderboard', requireAdmin, (req, res) => {
  try {
    const realUsers = Array.from(users.values()).filter(u =>
      !u.id?.startsWith('bot-') && u.phone && u.isActive !== false
    );
    const leaderboard = realUsers.map(u => {
      const wallet = wallets.get(u.id) || { balance: '0.00', depositCount: 0, totalDeposited: 0 };
      const userTx = transactions.filter(tx => tx.userId === u.id);
      const totalWagered = userTx.filter(tx => tx.type === 'bet').reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
      const totalWon = userTx.filter(tx => tx.type === 'cashout').reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
      const biggestWin = userTx.filter(tx => tx.type === 'cashout').reduce((max, tx) => Math.max(max, Number(tx.amount) || 0), 0);
      const totalDeposited = Number(wallet.totalDeposited || 0);
      return {
        id: u.id,
        username: u.username,
        phone: u.phone,
        balance: parseFloat(wallet.balance || '0'),
        depositCount: Number(wallet.depositCount || 0),
        totalDeposited,
        totalWagered,
        totalWon,
        biggestWin,
        role: u.role,
      };
    });
    leaderboard.sort((a, b) => b.totalDeposited - a.totalDeposited);
    leaderboard.forEach((p, i) => { p.rank = i + 1; });
    res.json({ leaderboard: leaderboard.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ message: 'Failed to fetch leaderboard' });
  }
});

app.post('/api/admin/broadcast', requireAdmin, (req, res) => {
  try {
    const { message, type } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ message: 'Message is required' });
    const admin = getAuthUser(req);
    const payload = {
      message: message.trim(),
      type: type || 'info',
      from: admin?.username || 'Admin',
      timestamp: new Date().toISOString(),
    };
    io.emit('admin:broadcast', payload);
    res.json({ message: 'Broadcast sent', recipients: io.engine.clientsCount, payload });
  } catch (e) {
    res.status(500).json({ message: 'Failed to broadcast' });
  }
});

app.post('/api/admin/rain', requireAdmin, async (req, res) => {
  try {
    const { amount, message } = req.body;
    const rainAmount = parseFloat(amount);
    if (!rainAmount || rainAmount <= 0) return res.status(400).json({ message: 'Invalid rain amount' });

    const sockets = await io.fetchSockets();
    const onlineUserIds = [...new Set(sockets.map(s => s.odlutUserId).filter(Boolean))];

    if (onlineUserIds.length === 0) return res.status(400).json({ message: 'No players online to receive rain' });

    const perUser = Math.floor((rainAmount / onlineUserIds.length) * 100) / 100;
    if (perUser < 1) return res.status(400).json({ message: 'Amount too small to split among online players' });

    const recipients = [];
    for (const userId of onlineUserIds) {
      const wallet = wallets.get(userId);
      if (!wallet) continue;
      wallet.balance = (parseFloat(wallet.balance) + perUser).toFixed(2);
      wallets.set(userId, wallet);
      io.to(userId).emit('wallet:update', { balance: wallet.balance });
      const user = getUserById(userId);
      if (user) recipients.push({ username: user.username, amount: perUser });
    }

    await saveStore();

    const admin = getAuthUser(req);
    io.emit('admin:rain', {
      message: message || `It's raining! Each online player received KES ${perUser}`,
      amount: perUser,
      totalAmount: rainAmount,
      from: admin?.username || 'Admin',
      recipients: recipients.length,
      timestamp: new Date().toISOString(),
    });

    res.json({ message: 'Rain successful', recipients: recipients.length, perUser, totalAmount: rainAmount, users: recipients });
  } catch (e) {
    console.error('Rain failed:', e);
    res.status(500).json({ message: 'Rain failed' });
  }
});

app.get('/api/admin/users/:id/profile', requireAdmin, (req, res) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const wallet = wallets.get(user.id) || { balance: '0.00', depositCount: 0, totalDeposited: 0 };
    const userTx = transactions.filter(tx => tx.userId === user.id).slice(0, 100);
    const totalWagered = transactions.filter(tx => tx.userId === user.id && tx.type === 'bet').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const totalWon = transactions.filter(tx => tx.userId === user.id && tx.type === 'cashout').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    res.json({
      id: user.id, username: user.username, email: user.email,
      phone: user.phone, role: user.role, isActive: user.isActive !== false,
      createdAt: user.createdAt,
      balance: wallet.balance,
      depositCount: wallet.depositCount || 0,
      totalDeposited: wallet.totalDeposited || 0,
      totalWagered, totalWon,
      transactions: userTx,
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

app.get('/api/admin/round-history', requireAdmin, (req, res) => {
  try {
    const history = (gameState.history || []).map((crashPoint, index) => ({
      round: gameState.roundNumber - index,
      crashPoint: Number(crashPoint),
    }));
    res.json({
      history,
      totalRounds: gameStats.totalRounds,
      averageCrashPoint: gameStats.averageCrashPoint,
      currentPhase: gameState.phase,
      currentMultiplier: gameState.multiplier,
      currentRound: gameState.roundNumber,
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to fetch round history' });
  }
});

app.get('/api/admin/online-players', requireAdmin, async (req, res) => {
  try {
    const sockets = await io.fetchSockets();
    const seenUserIds = new Set();
    const players = sockets
      .filter(s => s.odlutUserId)
      .filter((socket) => {
        if (seenUserIds.has(socket.odlutUserId)) return false;
        seenUserIds.add(socket.odlutUserId);
        return true;
      })
      .map(s => {
        const user = getUserById(s.odlutUserId);
        const wallet = wallets.get(s.odlutUserId);
        return {
          userId: s.odlutUserId,
          username: user?.username || s.username || 'Unknown',
          phone: user?.phone || null,
          email: user?.email || null,
          balance: wallet?.balance || '0.00',
          depositCount: Number(wallet?.depositCount || 0),
          totalDeposited: Number(wallet?.totalDeposited || 0),
          role: user?.role || 'user',
          isActive: user?.isActive !== false,
          connectedAt: s.handshake?.time || null,
          socketId: s.id,
        };
      });
    res.json({ players, total: players.length, connectedClients: players.length });
  } catch (e) {
    res.status(500).json({ message: 'Failed to fetch online players' });
  }
});


let serverStarted = false;

function startServer() {
  if (serverStarted) return;
  serverStarted = true;
  server.listen(PORT, () => {
    console.log(`✅ Aviator Backend on port ${PORT}`);
    const adapter = getPersistenceAdapter();
    console.log(adapter === mongodb ? '📦 Persistence: MongoDB' : '📦 Persistence: local JSON');

    // ArchPay reads its webhook URL from the dashboard rather than from each
    // STK push, so a mismatch here is invisible until deposits stop being
    // credited. Print the exact URL to register, and say plainly when live
    // deposits are switched off for want of credentials.
    if (archpay.isConfigured()) {
      console.log(`💳 Payments: ArchPay — register this webhook URL in ArchPay → Settings: ${archpay.getCallbackUrl()}`);
    } else {
      console.warn(`⚠️  Payments: ArchPay is not configured — deposits are disabled. ${archpay.getConfigurationError()}`);
    }
  });
}

const handleShutdown = async (signal) => {
  try {
    console.warn(`⚠️  ${signal} received. Saving state before shutdown...`);
    await saveStore();
  } catch (err) {
    console.error('Failed to save state during shutdown:', err?.message || err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

async function bootstrapApplication() {
  let restoreResult = null;

  try {
    restoreResult = await bootstrapPersistence();
  } catch (error) {
    // bootstrapPersistence normally handles storage failures itself; keep this
    // guard so a bad persistence provider cannot leave Render serving an empty
    // account map.
    console.error('Failed to bootstrap persistence:', error?.message || error);
  }

  try {
    await ensureCriticalAccounts();
  } catch (error) {
    console.error('Failed to synchronise critical accounts:', error?.message || error);
    seedDefaultUsers();
  }

  console.log(`✅ Loaded ${users.size} users and ${wallets.size} wallets`);

  // A deployment restart must not strand an in-flight STK request. Resume a
  // fresh status check immediately, while the expiry sweep closes any request
  // that is already outside the provider's prompt window.
  await expirePendingArchPayDeposits();
  transactions
    .filter((tx) => isMpesaDeposit(tx) && (tx.status === 'initiating' || tx.status === 'pending'))
    .forEach((tx) => pollPaymentStatusFallback(
      tx,
      tx.providerReference || tx.reference,
      tx.checkoutRequestId || tx.reference,
      tx.externalReference || tx.reference,
    ));

  if (restoreResult?.changed) {
    setTimeout(() => {
      saveStore().catch((err) => console.warn('Deferred save failed:', err?.message || err));
    }, 1000);
  }
}

// Do not expose login routes until persistence and the required administrator
// accounts are ready. Render may route traffic as soon as the port opens; the
// previous order allowed a cold-start login to race the account bootstrap.
bootstrapApplication()
  .catch((error) => {
    console.error('Unexpected startup failure:', error?.message || error);
    seedDefaultUsers();
  })
  .finally(startServer);
