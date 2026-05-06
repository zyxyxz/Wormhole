"use strict";

// Outbox: persistent per-space message queue. Entries persist across app
// reloads via wx.setStorageSync. Entries are removed when the server echoes
// back (matching by client_id) or when the user explicitly discards a failed
// entry.
//
// Each entry shape:
//   {
//     client_id: string,        // canonical key for matching server echoes
//     payload: object,          // the WS message payload (with client_id)
//     status: 'sending'|'sent'|'failed',
//     attempts: number,         // count of send attempts
//     enqueued_at: number,      // ms epoch when enqueued
//     last_attempt_at: number|null,
//   }

const MAX_RETRY = 5;

function _key(spaceId) {
  return `chat_outbox_${spaceId}`;
}

function _readQueue(spaceId) {
  if (!spaceId) return [];
  try {
    const raw = wx.getStorageSync(_key(spaceId));
    if (!Array.isArray(raw)) return [];
    return raw;
  } catch (e) {
    return [];
  }
}

function _writeQueue(spaceId, queue) {
  if (!spaceId) return;
  try {
    wx.setStorageSync(_key(spaceId), queue);
  } catch (e) {}
}

function listPending(spaceId) {
  return _readQueue(spaceId);
}

function enqueue(spaceId, payload) {
  if (!spaceId || !payload || !payload.client_id) return null;
  const queue = _readQueue(spaceId);
  // Dedupe by client_id: if already present, return existing.
  const existing = queue.find((e) => e.client_id === payload.client_id);
  if (existing) return existing;
  const entry = {
    client_id: payload.client_id,
    payload,
    status: "sending",
    attempts: 0,
    enqueued_at: Date.now(),
    last_attempt_at: null,
  };
  queue.push(entry);
  _writeQueue(spaceId, queue);
  return entry;
}

function markAttempt(spaceId, clientId) {
  const queue = _readQueue(spaceId);
  let changed = false;
  let nextStatus = null;
  for (const entry of queue) {
    if (entry.client_id === clientId) {
      entry.attempts += 1;
      entry.last_attempt_at = Date.now();
      if (entry.attempts >= MAX_RETRY) {
        entry.status = "failed";
      }
      nextStatus = entry.status;
      changed = true;
      break;
    }
  }
  if (changed) _writeQueue(spaceId, queue);
  return nextStatus;
}

function removeByClientId(spaceId, clientId) {
  if (!clientId) return false;
  const queue = _readQueue(spaceId);
  const next = queue.filter((e) => e.client_id !== clientId);
  if (next.length !== queue.length) {
    _writeQueue(spaceId, next);
    return true;
  }
  return false;
}

function getByClientId(spaceId, clientId) {
  return _readQueue(spaceId).find((e) => e.client_id === clientId) || null;
}

function retry(spaceId, clientId) {
  const queue = _readQueue(spaceId);
  for (const entry of queue) {
    if (entry.client_id === clientId) {
      entry.status = "sending";
      entry.attempts = 0;
      entry.last_attempt_at = null;
      _writeQueue(spaceId, queue);
      return entry;
    }
  }
  return null;
}

function clear(spaceId) {
  _writeQueue(spaceId, []);
}

module.exports = {
  MAX_RETRY,
  listPending,
  enqueue,
  markAttempt,
  removeByClientId,
  getByClientId,
  retry,
  clear,
};
