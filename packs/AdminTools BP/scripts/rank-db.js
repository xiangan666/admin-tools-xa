/**
 * rank-db.js — Predefined rank database
 *
 * Stored in world dynamic property "jm_at:rank_db" as JSON:
 *   { "VIP": { tag: "§6[VIP]§r" }, "Builder": { tag: "§b[Builder]§r" }, ... }
 *
 * Internal name = object key (alphanumeric + underscore, max 20 chars).
 * Display tag   = the visible string shown above player heads (max 40 chars).
 *
 * Admins manage ranks via ui-admin.js (Rank Manager).
 */

import { KEY, LIMITS } from "./constants.js";
import { getWorldStr, setWorldStr } from "./storage.js";
import { silentCatch } from "./utils.js";

export function getRankDb() {
  try {
    const raw = getWorldStr(KEY.rankDb);
    if (raw) return JSON.parse(raw);
  } catch (e) { silentCatch("rankdb_getRankDb", e); }
  return {};
}

export function setRankDb(db) {
  setWorldStr(KEY.rankDb, JSON.stringify(db));
}

export function addRank(name, tag) {
  const db = getRankDb();
  if (db[name]) return false;
  if (Object.keys(db).length >= LIMITS.RANK_DB_MAX) return false;
  db[name] = { tag };
  setRankDb(db);
  return true;
}

export function updateRank(name, tag) {
  const db = getRankDb();
  if (!db[name]) return false;
  db[name].tag = tag;
  setRankDb(db);
  return true;
}

export function removeRank(name) {
  const db = getRankDb();
  if (!db[name]) return false;
  delete db[name];
  setRankDb(db);
  return true;
}

export function getRankNames() {
  return Object.keys(getRankDb()).sort((a, b) => a.localeCompare(b));
}
