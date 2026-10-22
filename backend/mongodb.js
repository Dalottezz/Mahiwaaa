const { MongoClient } = require('mongodb');
const dns = require('dns');

// Use Google/Cloudflare DNS to reliably resolve MongoDB Atlas SRV records on local networks
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  /* ignore fallback */
}

// MongoDB connection configuration — require providing a connection URI via environment.
// Do NOT hard-code credentials here. Provide a proper `MONGODB_URI` in your env (Atlas connection string).
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'aviator_innit';

let client = null;
let db = null;
let usersCollection = null;
let walletsCollection = null;
let settingsCollection = null;
let transactionsCollection = null;
let warnedNoUri = false;

function isConfigured() {
  return Boolean(MONGODB_URI && MONGODB_URI.trim());
}

let lastErrorTime = 0;

async function connect() {
  if (!isConfigured()) {
    if (!warnedNoUri) {
      console.log('ℹ️ MONGODB_URI is not configured — running with local in-memory state.');
      warnedNoUri = true;
    }
    return false;
  }

  if (Date.now() - lastErrorTime < 30000) {
    return false;
  }

  try {
    if (client && client.topology && client.topology.isConnected()) {
      return true;
    }
    console.log('🔗 Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
    });

    await client.connect();
    db = client.db(MONGODB_DB_NAME);

    // Create collections if they don't exist
    usersCollection = db.collection('users');
    walletsCollection = db.collection('wallets');
    settingsCollection = db.collection('settings');
    transactionsCollection = db.collection('transactions');

    // Create indexes for faster queries
    await usersCollection.createIndex({ phone: 1 }, { unique: true, sparse: true });
    await usersCollection.createIndex({ email: 1 }, { unique: true, sparse: true });
    await walletsCollection.createIndex({ userId: 1 }, { unique: true });
    await transactionsCollection.createIndex({ id: 1 }, { unique: true });
    await transactionsCollection.createIndex({ externalReference: 1 }, { sparse: true });
    await transactionsCollection.createIndex({ checkoutRequestId: 1 }, { sparse: true });

    console.log('✅ MongoDB connected successfully');
    lastErrorTime = 0;
    return true;
  } catch (err) {
    lastErrorTime = Date.now();
    console.error('❌ MongoDB connection failed:', err.message);
    return false;
  }
}

async function disconnect() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

async function loadState() {
  if (!isConfigured()) return null;
  try {
    const connected = await connect();
    if (!connected || !usersCollection || !walletsCollection) return null;

    const users = await usersCollection.find({}).toArray();
    const walletsRaw = await walletsCollection.find({}).toArray();

    // Convert MongoDB format to expected format
    const wallets = walletsRaw.map(w => [w.userId, { balance: w.balance, depositCount: w.depositCount, totalDeposited: w.totalDeposited }]);

    return { users, wallets };
  } catch (err) {
    console.error('Failed to load state from MongoDB:', err.message);
    return null;
  }
}

// An unordered bulkWrite still throws once any single operation fails (e.g.
// a stray duplicate-key conflict on one pre-existing document), even though
// every other document in the batch was written successfully. Treat that as
// a partial success instead of aborting the whole save: log which write(s)
// need attention without blocking the hundreds of good ones behind them.
async function bulkWriteTolerant(collection, operations, label) {
  try {
    await collection.bulkWrite(operations, { ordered: false });
  } catch (err) {
    const writeErrors = err?.writeErrors || err?.result?.writeErrors || [];
    if (writeErrors.length) {
      console.error(`${writeErrors.length} of ${operations.length} ${label} writes failed (rest succeeded):`,
        writeErrors.slice(0, 3).map((e) => e.errmsg || e.message).join(' | '));
    } else {
      throw err;
    }
  }
}

async function saveState(users, wallets) {
  if (!isConfigured()) return false;
  try {
    const connected = await connect();
    if (!connected || !usersCollection || !walletsCollection) return false;

    const usersArray = Array.from(users.values());
    const walletsArray = Array.from(wallets.entries()).map(([userId, wallet]) => ({
      userId,
      balance: wallet.balance,
      depositCount: wallet.depositCount,
      totalDeposited: wallet.totalDeposited || 0,
      updatedAt: new Date(),
    }));

    // Upsert users and wallets in a single round trip each, the same way
    // saveTransactions already does below. A one-request-per-document loop
    // here made every save take as long as the entire user base times a
    // network round trip — with hundreds of users that stalled every admin
    // action (and the deposit success/failure socket updates) for minutes.
    // The two collections are independent, so write them concurrently
    // instead of one after the other.
    await Promise.all([
      usersArray.length ? bulkWriteTolerant(usersCollection, usersArray.map((user) => {
        const { _id, ...cleanUser } = user;
        return {
          updateOne: {
            filter: { id: user.id },
            update: { $set: { ...cleanUser, updatedAt: new Date() } },
            upsert: true,
          },
        };
      }), 'user') : null,
      walletsArray.length ? bulkWriteTolerant(walletsCollection, walletsArray.map((wallet) => {
        const { _id, ...cleanWallet } = wallet;
        return {
          updateOne: {
            filter: { userId: wallet.userId },
            update: { $set: cleanWallet },
            upsert: true,
          },
        };
      }), 'wallet') : null,
    ]);

    return true;
  } catch (err) {
    console.error('Failed to save state to MongoDB:', err.message);
    return false;
  }
}

async function loadSettings() {
  if (!isConfigured()) return null;
  try {
    const connected = await connect();
    if (!connected || !settingsCollection) return null;
    const settings = await settingsCollection.findOne({ _id: 'siteSettings' });
    return settings ? { ...settings, _id: undefined } : null;
  } catch (err) {
    console.warn('Failed to load settings from MongoDB:', err.message);
    return null;
  }
}

async function upsertSettings(settings) {
  if (!isConfigured()) return false;
  try {
    const connected = await connect();
    if (!connected || !settingsCollection) return false;
    const { _id, ...cleanSettings } = settings || {};
    await settingsCollection.updateOne(
      { _id: 'siteSettings' },
      { $set: { ...cleanSettings, updatedAt: new Date() } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.error('Failed to save settings to MongoDB:', err.message);
    return false;
  }
}

async function loadTransactions(limit = 500) {
  if (!isConfigured()) return [];
  try {
    const connected = await connect();
    if (!connected || !transactionsCollection) return [];
    return await transactionsCollection.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  } catch (err) {
    console.error('Failed to load transactions from MongoDB:', err.message);
    return [];
  }
}

async function saveTransactions(transactions) {
  if (!isConfigured()) return false;
  try {
    const connected = await connect();
    if (!connected || !transactionsCollection) return false;
    if (!Array.isArray(transactions) || !transactions.length) return true;
    await bulkWriteTolerant(transactionsCollection, transactions.map((transaction) => {
      const { _id, ...cleanTx } = transaction;
      return {
        updateOne: {
          filter: { id: transaction.id },
          update: { $set: { ...cleanTx, updatedAt: new Date() } },
          upsert: true,
        },
      };
    }), 'transaction');
    return true;
  } catch (err) {
    console.error('Failed to save transactions to MongoDB:', err.message);
    return false;
  }
}

// saveTransactions([]) is a no-op against Mongo — an empty array upserts
// nothing, it doesn't remove existing documents — so clearing transaction
// history needs an actual delete, not a save with an empty list.
async function deleteAllTransactions() {
  if (!isConfigured()) return false;
  try {
    const connected = await connect();
    if (!connected || !transactionsCollection) return false;
    await transactionsCollection.deleteMany({});
    return true;
  } catch (err) {
    console.error('Failed to delete transactions from MongoDB:', err.message);
    return false;
  }
}

module.exports = {
  connect,
  disconnect,
  isConfigured,
  getClient: () => client,
  getDb: () => db,
  loadState,
  saveState,
  loadSettings,
  upsertSettings,
  loadTransactions,
  saveTransactions,
  deleteAllTransactions,
};
