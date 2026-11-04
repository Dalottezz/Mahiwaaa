function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith('254') && digits.length >= 12) return digits;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

const RESTRICTED_SUPERADMIN_PHONES = ['254723924722'];

function isRestrictedSuperAdmin(user) {
  if (!user) return false;
  const isSuper = String(user?.role || '').toUpperCase() === 'SUPER_ADMIN';
  if (!isSuper) return false;
  const phone = normalizePhone(user?.phone);
  if (phone && RESTRICTED_SUPERADMIN_PHONES.includes(phone)) return true;
  return user.adminVisibility === 'superadmins_only';
}

function isSameAccount(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  const phoneA = normalizePhone(a.phone);
  const phoneB = normalizePhone(b.phone);
  if (phoneA && phoneB && phoneA === phoneB) return true;
  return false;
}

function canViewAccount(viewer, account) {
  if (isRestrictedSuperAdmin(account)) {
    return isSameAccount(viewer, account);
  }
  return true;
}

module.exports = { isRestrictedSuperAdmin, canViewAccount, isSameAccount, normalizePhone, RESTRICTED_SUPERADMIN_PHONES };
