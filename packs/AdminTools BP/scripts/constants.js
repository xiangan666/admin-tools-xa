/**
 * constants.js — Shared constants, namespaces, keys, and limits
 */

export const NS = "jm_at";
export const VER = "2.5.3 相安版（基于 v2.2.2）"; // string shown in UI, update on manifest change

// Build-time feature kill switches. When a feature is `false` it does not exist
// to anyone: no item given, no menu buttons, no join behavior, no config entry.
// Flip to `true` to ship the feature; cfg.<feature>Enabled is the live admin
// toggle that only matters once the flag here is on.
export const FEATURES = {
  kits: true, // Player kits (kit_tool). Stable — shipping in v2.2.
};

// JM support accounts that can be owner-granted support access and are
// auto-added to the in-addon server whitelist when they join.
export const SUPPORT_ACCESS_NAMES = ["deathly pain", "jmaddons"];

export const KEY = {
  cfg: `${NS}:cfg`,
  ticketMeta: `${NS}:ticket_meta`,
  ticketPage: (i) => `${NS}:ticket_page_${String(i).padStart(2, "0")}`,
  logMeta: `${NS}:log_meta`,
  logPage: (i) => `${NS}:log_page_${String(i).padStart(2, "0")}`,
  playerReg: `${NS}:plr_reg`, // Legacy single-property registry (migration source)
  playerRegMeta: `${NS}:plr_reg_meta`,
  playerRegPage: (i) => `${NS}:plr_reg_${String(i).padStart(2, "0")}`,
  sessionLog: `${NS}:session_log`, // Rollcall / join-leave session log
  claimsMeta: `${NS}:claims_meta`,
  claimsPage: (i) => `${NS}:claims_page_${String(i).padStart(2, "0")}`,
  claimLog: `${NS}:claim_log`,
  rankDb: `${NS}:rank_db`,
  banLedger: `${NS}:ban_ledger`,
  hologramRegistry: `${NS}:hologram_registry`,
  playerNotes: (xuid) => `${NS}:notes_${xuid}`,
  playerPunishments: (xuid) => `${NS}:puns_${xuid}`,
  // Per-staff privilege overrides, world-level so they can be edited while the
  // staff member is offline (the player-level PKEY copies below are legacy and
  // migrated on login). Keyed by XUID.
  modOverrides: (xuid) => `${NS}:mod_ovr_${xuid}`,
  adminOverrides: (xuid) => `${NS}:admin_ovr_${xuid}`,
  kits: `${NS}:kits`, // Kit definitions { [name]: def }
  commandPresets: `${NS}:command_presets`, // owner-curated one-tap command buttons [{ id, name, command }]
};

export const PKEY = {
  core: `${NS}:plr_core`,
  role: `${NS}:role`, // private staff-role record: "admin" | "moderator" | undefined
  // Set true once join-time tag reconciliation has grandfathered this player's
  // existing staff tags. After that, any admin/mod tag not backed by `role`
  // (or operator/owner/support) is treated as planted and stripped on join.
  staffReconciled: `${NS}:staff_reconciled`,
  // Legacy per-staff override storage on the player entity. Migrated to the
  // world-level KEY.modOverrides/adminOverrides on login; kept only as a
  // migration source and removed once copied.
  modOverrides: `${NS}:mod_overrides`, // legacy per-mod privilege overrides (JSON)
  adminOverrides: `${NS}:admin_overrides`, // legacy per-admin privilege overrides (JSON)
  adminCommands: (xuid) => `${NS}:cmds_${xuid}`, // per-admin command list
};

export const LIMITS = {
  TICKET_PAGES: 20, // x 25 = 500 max tickets
  TICKETS_PER_PAGE: 25,
  LOG_PAGES: 20, // x 40 = 800 log entries
  LOGS_PER_PAGE: 40,
  MY_TICKETS_MAX: 60,
  PUNISHMENTS_MAX: 30,
  NOTE_MAX_LEN: 400,
  DESC_MAX_LEN: 400,
  SCHEDULED_BROADCASTS_MAX: 5,
  // Player registry capacity. Pages are allocated on demand and entries are
  // assigned to a page by explicit xuidToPage lookup (NOT by hash%pageCount),
  // so these counts may be RAISED safely on a live world without remapping or
  // orphaning existing data — never LOWER them (that would strand populated
  // pages above the new ceiling). REGISTRY_PER_PAGE is byte-tuned to the 32KB
  // per-property wall: scale capacity by adding pages, not by widening a page.
  PLAYER_REGISTRY_MAX: 1500, // Most recent players kept in world-level registry
  REGISTRY_PAGES: 20, // Pages for paged player registry (20 x 80 = 1600 slots)
  REGISTRY_PER_PAGE: 80, // Entries per registry page (~80 fits within 32KB)
  COMMANDS_MAX: 50, // Max saved commands per admin
  COMMAND_PRESETS_MAX: 30, // Max owner-curated command buttons (shared, world-level)
  // How often the saved-command scheduler runs, in ticks. Also the smallest
  // interval a command can fire at — a command can't fire faster than the loop
  // that checks it. 10 ticks = 0.5s.
  COMMAND_TICK_INTERVAL: 10,
  SESSION_LOG_MAX: 80, // Max join/leave events kept
  SPY_HISTORY_MAX: 10, // Max spy sessions kept per player profile
  ADMIN_NOTES_MAX: 20, // Max notes per player profile
  ECHEST_SLOTS: 27, // Ender chest has 27 slots
  // Claims capacity. Same allocation/backward-safety rules as the registry above
  // (explicit idToPage mapping, raise-only). 300 x 30 = 9000 claims comfortably
  // covers 1500 players x maxClaimsPerPlayer(5)=7500 with headroom. CLAIMS_PER_PAGE
  // is byte-tuned: a full claim (up to MEMBERS_PER_CLAIM + TRUSTED_RANKS_PER_CLAIM)
  // is large, so ~30 per page is the 32KB ceiling — add pages, don't widen them.
  CLAIMS_PAGES: 300,
  CLAIMS_PER_PAGE: 30,
  CLAIM_LOG_MAX: 150,
  CLAIM_NAME_MAX: 32,
  CLAIM_WELCOME_MAX: 120, // per-claim custom entry message length
  SUBCLAIMS_PER_CLAIM: 10,
  MEMBERS_PER_CLAIM: 30, // cap members per claim (keeps a claims page under the 32KB property limit)
  TRUSTED_RANKS_PER_CLAIM: 30, // cap trusted ranks per claim (same reason)
  RANK_DB_MAX: 100, // Max predefined ranks in database
  PLAYTIME_RANKS_MAX: 20, // Max playtime-based rank thresholds
  RANK_NAME_MAX: 20, // Internal rank name length
  RANK_TAG_MAX: 40, // Display tag length
  BULK_ASSIGN_PAGE: 30, // Players per page in bulk assign
  HOLOGRAM_LINE_MAX: 10,
  HOLOGRAM_LINE_LEN: 60,
  BAN_LEDGER_MAX: 50,
  REGISTRY_WARN_THRESHOLD: 1350, // 90% of PLAYER_REGISTRY_MAX
  HOLOGRAM_REGISTRY_MAX: 100,
  WHITELIST_MAX: 200,
  MAX_KITS: 30, // Max kits that can be defined
  MAX_KIT_ITEMS: 41, // Distinct item entries per kit (full inventory + armor + offhand)
  MAX_KIT_ITEM_AMOUNT: 2304, // 64 x 36 — one full inventory's worth per item entry
  KIT_NAME_MAX: 24,

  // Per-dynamic-property byte ceiling. Bedrock caps a single string dynamic
  // property at 32767 bytes; a write over that throws and the data is lost.
  // We refuse oversized writes proactively (see setWorldStr/setPlayerCore) with
  // a clear message instead of silently failing. WARN fires a one-time heads-up
  // as a blob approaches the wall so admins can trim before it breaks.
  MAX_PROP_BYTES: 32767,
  PROP_WARN_BYTES: 30000,

  // Whole-world dynamic-property budget (sum of EVERY property this pack stores,
  // read via world.getDynamicPropertyTotalByteCount()). Bedrock does not publish
  // a hard per-world total cap — the real write-breaking wall is MAX_PROP_BYTES
  // per individual property — so this is an ADVISORY backstop only: a heads-up
  // that the world store has grown unusually large (e.g. registry + claims pages
  // both near full), not an engine limit. ~8 MB sits well above a fully-loaded
  // 1500-player / 9000-claim world's expected footprint.
  DP_TOTAL_SOFT_WARN_BYTES: 8_000_000,
};

export const ITEMS = {
  adminTool: `${NS}:admin_tool`,
  ticketMenu: `${NS}:ticket_menu`,
  claimWand: `${NS}:claim_wand`,
  claimViewer: `${NS}:claim_viewer`,
  hologramTool: `${NS}:hologram_tool`,
  chestSorter: `${NS}:chest_sorter`,
  kitTool: `${NS}:kit_tool`,
};

export const GAMEMODES = ["survival", "creative", "adventure", "spectator"];

// labelKey/shortLabelKey are lang keys (jm_at.prot.*) for DISPLAY surfaces;
// the plain label/shortLabel strings remain for any logic/stored use.
// lang-keys: jm_at.prot.*
export const PROTECTION_DEFS = [
  {
    key: "blocks",
    label: "Protect blocks (building & breaking)",
    labelKey: "jm_at.prot.blocks",
    shortLabel: "Blocks",
    shortLabelKey: "jm_at.prot.blocks_short",
  },
  {
    key: "containers",
    label: "Protect containers (chests, barrels, etc.)",
    labelKey: "jm_at.prot.containers",
    shortLabel: "Containers",
    shortLabelKey: "jm_at.prot.containers_short",
  },
  {
    key: "entities",
    label: "Protect entities (mobs)",
    labelKey: "jm_at.prot.entities",
    shortLabel: "Entities (mobs)",
    shortLabelKey: "jm_at.prot.entities_short",
  },
  {
    key: "allowVehicles",
    label: "Exempt vehicles from entity protection",
    labelKey: "jm_at.prot.allow_vehicles",
    shortLabel: "Allow Vehicle Use",
    shortLabelKey: "jm_at.prot.allow_vehicles_short",
  },
  {
    key: "pvp",
    label: "Disable PvP inside claim",
    labelKey: "jm_at.prot.pvp",
    shortLabel: "PvP",
    shortLabelKey: "jm_at.prot.pvp_short",
  },
  {
    key: "interactions",
    label: "Protect interactions (doors, buttons, levers)",
    labelKey: "jm_at.prot.interactions",
    shortLabel: "Interactions",
    shortLabelKey: "jm_at.prot.interactions_short",
  },
  {
    key: "itemUse",
    label: "Protect item use (buckets, flint & steel)",
    labelKey: "jm_at.prot.item_use",
    shortLabel: "Item Use",
    shortLabelKey: "jm_at.prot.item_use_short",
  },
  {
    key: "explosions",
    label: "Protect from explosions",
    labelKey: "jm_at.prot.explosions",
    shortLabel: "Explosions",
    shortLabelKey: "jm_at.prot.explosions_short",
  },
  {
    key: "hostileMobs",
    label: "Prevent hostile mob spawning",
    labelKey: "jm_at.prot.hostile_mobs",
    shortLabel: "Hostile Mobs",
    shortLabelKey: "jm_at.prot.hostile_mobs_short",
  },
  {
    key: "cropTrampling",
    label: "Protect crops (farmland trampling)",
    labelKey: "jm_at.prot.crop_trampling",
    shortLabel: "Crop Trampling",
    shortLabelKey: "jm_at.prot.crop_trampling_short",
  },
  {
    key: "fireSpread",
    label: "Prevent fire spread",
    labelKey: "jm_at.prot.fire_spread",
    shortLabel: "Fire Spread",
    shortLabelKey: "jm_at.prot.fire_spread_short",
  },
  {
    key: "enderPearls",
    label: "Block ender pearl entry",
    labelKey: "jm_at.prot.ender_pearls",
    shortLabel: "Ender Pearls",
    shortLabelKey: "jm_at.prot.ender_pearls_short",
  },
  {
    key: "ejectPlayers",
    label: "Eject untrusted players",
    labelKey: "jm_at.prot.eject_players",
    shortLabel: "Eject Untrusted Players",
    shortLabelKey: "jm_at.prot.eject_players_short",
  },
];

// Built-in entity types that are always safe from hostile-mob claim protection.
// Frozen so callers cannot accidentally mutate the source-of-truth list.
// SAFE_ENTITY_TYPES (below) is the runtime Set derived from this — it is mutable
// so admins can add/remove entries via /jm_at:mobwhitelist without a reload.
export const HARDCODED_SAFE_ENTITY_TYPES = Object.freeze([
  // Players & drops
  "minecraft:player",
  "minecraft:item",
  "minecraft:xp_orb",
  // Projectiles & thrown items
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:ender_pearl",
  "minecraft:splash_potion",
  "minecraft:lingering_potion",
  "minecraft:egg",
  "minecraft:snowball",
  "minecraft:xp_bottle", // thrown bottle o' enchanting — harmless projectile
  "minecraft:eye_of_ender_signal", // thrown eye of ender — harmless, locates stronghold
  "minecraft:fishing_hook",
  "minecraft:wind_charge_projectile",
  // Utility & decoration
  "minecraft:armor_stand",
  "minecraft:painting",
  "minecraft:frame",
  "minecraft:glow_frame",
  "minecraft:leash_knot",
  "minecraft:npc",
  "minecraft:ominous_item_spawner", // drops trial-spawner loot — harmless utility
  "minecraft:elder_guardian_ghost", // elder guardian curse visual — harmless
  "minecraft:falling_block",
  "minecraft:tnt",
  "minecraft:ender_crystal",
  "minecraft:fireworks_rocket",
  "minecraft:area_effect_cloud",
  "minecraft:lightning_bolt",
  // Vehicles
  "minecraft:minecart",
  "minecraft:boat",
  "minecraft:chest_boat",
  "minecraft:chest_minecart",
  "minecraft:hopper_minecart",
  "minecraft:tnt_minecart",
  "minecraft:command_block_minecart",
  // Passive & neutral mobs
  "minecraft:villager",
  "minecraft:villager_v2",
  "minecraft:wandering_trader",
  "minecraft:iron_golem",
  "minecraft:snow_golem",
  "minecraft:cat",
  "minecraft:wolf",
  "minecraft:horse",
  "minecraft:donkey",
  "minecraft:mule",
  "minecraft:llama",
  "minecraft:trader_llama",
  "minecraft:parrot",
  "minecraft:fox",
  "minecraft:bee",
  "minecraft:pig",
  "minecraft:cow",
  "minecraft:mooshroom",
  "minecraft:sheep",
  "minecraft:chicken",
  "minecraft:rabbit",
  "minecraft:squid",
  "minecraft:glow_squid",
  "minecraft:turtle",
  "minecraft:dolphin",
  "minecraft:ocelot",
  "minecraft:panda",
  "minecraft:polar_bear",
  "minecraft:strider",
  "minecraft:axolotl",
  "minecraft:goat",
  "minecraft:frog",
  "minecraft:tadpole",
  "minecraft:allay",
  "minecraft:camel",
  "minecraft:camel_husk", // passive (behaves like skeleton/zombie horse)
  "minecraft:sniffer",
  "minecraft:armadillo",
  "minecraft:happy_ghast",
  "minecraft:copper_golem",
  "minecraft:nautilus",
  "minecraft:zombie_nautilus", // neutral
  "minecraft:sulfur_cube",
  "minecraft:skeleton_horse",
  "minecraft:zombie_horse",
  "minecraft:salmon",
  "minecraft:cod",
  "minecraft:pufferfish",
  "minecraft:tropicalfish",
  "minecraft:bat",
  `${NS}:hologram`,
  `${NS}:hologram_v2`,
  `${NS}:hologram_hitbox`,
]);

// Mutable runtime set. main.js seeds it from mobWhitelist config on startup;
// ui-claims-admin.js mutates it when admins add/remove entries via the mob whitelist UI.
export const SAFE_ENTITY_TYPES = new Set(HARDCODED_SAFE_ENTITY_TYPES);

/** Namespace prefix of an entity id, incl. the colon (e.g. "minecraft:" from
 * "minecraft:zombie"). Empty string if there is no colon. */
export function entityNamespace(typeId) {
  const i = (typeId ?? "").indexOf(":");
  return i >= 0 ? typeId.slice(0, i + 1) : "";
}

/** Decide a hostile mob's fate against the claim mob lists. Specificity wins:
 * an exact (full-id) entry beats a namespace ("mypack:") entry, and the
 * blacklist breaks ties at the same specificity. So an admin can blacklist
 * "mypack:" yet whitelist "mypack:friendly" to spare that one. Returns
 * "remove", "spare", or null (no list opinion → caller's default rules apply).
 * Whitelist is the runtime SAFE_ENTITY_TYPES set (hardcoded-safe + admin adds). */
export function mobClaimDecision(typeId, blacklist) {
  const ns = entityNamespace(typeId);
  if (blacklist?.includes(typeId)) return "remove"; // exact blacklist (most specific)
  if (SAFE_ENTITY_TYPES.has(typeId)) return "spare"; // exact whitelist / hardcoded-safe
  if (blacklist?.includes(ns)) return "remove"; // namespace blacklist
  if (SAFE_ENTITY_TYPES.has(ns)) return "spare"; // namespace whitelist
  return null;
}
