const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isRestrictedSuperAdmin, canViewAccount } = require('./account-access');

const privateOwner = { id: 'private-owner', phone: '254700000002', role: 'SUPER_ADMIN', adminVisibility: 'superadmins_only', passwordHash: 'original' };
const ordinaryAdmin = { id: 'admin', role: 'ADMIN' };
const peerOwner = { id: 'peer-owner', role: 'SUPER_ADMIN' };

test('ordinary admins and public viewers cannot see the restricted owner', () => {
  for (const viewer of [ordinaryAdmin, { role: 'user' }, null]) {
    assert.equal(canViewAccount(viewer, privateOwner), false);
  }
});

test('superadmins retain visibility of the restricted owner', () => {
  assert.equal(canViewAccount(peerOwner, privateOwner), true);
  assert.equal(canViewAccount(privateOwner, privateOwner), true);
});

test('other superadmin, admin and player accounts retain their existing visibility', () => {
  for (const account of [peerOwner, ordinaryAdmin, { role: 'user' }]) {
    assert.equal(canViewAccount(ordinaryAdmin, account), true);
  }
});

test('a visibility value alone cannot grant a player superadmin protection', () => {
  const player = { role: 'user', adminVisibility: 'superadmins_only' };
  assert.equal(isRestrictedSuperAdmin(player), false);
  assert.equal(canViewAccount(ordinaryAdmin, player), true);
});

// Run only the startup routines in isolation, without starting the game or connecting to services.
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
function routine(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return source.slice(startIndex, endIndex);
}

test('startup preserves only the restricted additional superadmin and its existing wallet', async () => {
  const owner = { ...privateOwner };
  const users = new Map([[owner.id, owner], [peerOwner.id, { ...peerOwner, phone: '254700000003' }], [ordinaryAdmin.id, { ...ordinaryAdmin }]]);
  const wallet = { balance: '42.00', depositCount: 1 };
  const wallets = new Map([[owner.id, wallet]]);
  let saved = false;
  const context = {
    users, wallets, isRestrictedSuperAdmin,
    process: { env: { SEED_ADMIN_PHONE: '254700000001', SEED_ADMIN_PASSWORD: 'test-only' } },
    normalizePhone: value => value || null,
    findUserByPhone: phone => [...users.values()].find(user => user.phone === phone),
    normalizeWallet: value => value,
    bcrypt: { hash: async () => 'test-hash' },
    saveStore: async () => { saved = true; },
    console: { log() {} },
  };
  vm.createContext(context);
  vm.runInContext(routine('async function ensureCriticalAccounts()', '\nfunction createTransaction(') + '\nthis.runStartup = ensureCriticalAccounts;', context);
  await context.runStartup();
  assert.equal(users.get(owner.id).role, 'SUPER_ADMIN');
  assert.equal(users.get(owner.id).passwordHash, 'original');
  assert.equal(wallets.get(owner.id), wallet);
  assert.equal(users.get(peerOwner.id).role, 'ADMIN');
  assert.equal(users.get(ordinaryAdmin.id).role, 'ADMIN');
  assert.equal(saved, true);
});

test('an older local backup cannot overwrite the restricted account role or wallet', () => {
  const owner = { ...privateOwner };
  const wallet = { balance: '42.00', depositCount: 1 };
  const seed = { ...owner, role: 'ADMIN', adminVisibility: undefined, passwordHash: 'old' };
  const context = {
    isRestrictedSuperAdmin,
    loadCanonicalRestoreState: () => ({ users: new Map([[seed.id, seed]]), wallets: new Map([[seed.id, { balance: '0.00', depositCount: 0 }]]) }),
    normalizePhone: value => value,
    normalizeWallet: value => value,
  };
  vm.createContext(context);
  vm.runInContext(routine('function mergeRestoreState(', '\nasync function applyRestoreSnapshot(') + '\nthis.merge = mergeRestoreState;', context);
  const merged = context.merge({ users: [owner], wallets: [[owner.id, wallet]] });
  assert.equal(merged.users.get(owner.id).role, 'SUPER_ADMIN');
  assert.equal(merged.users.get(owner.id).passwordHash, 'original');
  assert.equal(merged.wallets.get(owner.id).balance, '42.00');
});
