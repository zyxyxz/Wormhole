// utils/routes.js — shared route classification used by theme.js,
// app-logger.js, and the Page wrapper.

exports.SPACE_ROUTES = new Set([
  'pages/chat/chat',
  'pages/notes/notes',
  'pages/explore/explore',
  'pages/notebook/notebook',
  'pages/vault/vault',
  'pages/notes-activity/notes-activity',
  'pages/emoji-diary/emoji-diary',
  'pages/space/space',
  'pages/wallet/wallet',
  'pages/post-create/post-create',
  'pages/note-edit/note-edit',
  'pages/recharge/recharge',
  'pages/settings/settings',
  'pages/notify/notify'
]);

exports.CUSTOM_NAV_ROUTES = new Set([
  'pages/index/index',
  'pages/chat/chat',
  'pages/notes/notes',
  'pages/explore/explore',
  'pages/notebook/notebook',
  'pages/vault/vault',
  'pages/notes-activity/notes-activity',
  'pages/emoji-diary/emoji-diary',
  'pages/note-edit/note-edit',
  'pages/wallet/wallet',
  'pages/settings/settings',
  'pages/notify/notify',
  'pages/join/join',
  'pages/admin/admin',
  'pages/admin-space/admin-space',
  'pages/admin-logs/admin-logs'
]);

exports.TAB_ROUTES = new Set([
  'pages/chat/chat',
  'pages/notes/notes',
  'pages/explore/explore',
  'pages/settings/settings'
]);
