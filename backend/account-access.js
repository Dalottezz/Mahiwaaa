function isRestrictedSuperAdmin(user) {
  return String(user?.role || '').toUpperCase() === 'SUPER_ADMIN' &&
    user.adminVisibility === 'superadmins_only';
}

function canViewAccount(viewer, account) {
  return !isRestrictedSuperAdmin(account) ||
    String(viewer?.role || '').toUpperCase() === 'SUPER_ADMIN';
}

module.exports = { isRestrictedSuperAdmin, canViewAccount };
