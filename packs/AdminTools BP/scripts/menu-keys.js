// menu-keys.js
// Stable string IDs persisted in cfg.menuVisibility, core.menuPrefs.hiddenTop,
// and core.menuPrefs.promoted.
// NEVER rename a key once shipped — old player records will silently lose their preference.

export const MENU_KEYS = Object.freeze({
  // Top-level (admin panel root)
  SEARCH: "search",
  TICKETS: "tickets",
  PLAYERS: "players",
  TELEPORT: "teleport",
  CONTROL_PANEL: "controlPanel",
  COMMANDS: "commands",
  WARPS: "warps",
  BROADCASTS: "broadcasts",
  ADMIN_LOG: "adminLog",
  INFO: "info",

  // Players submenu — sub-buttons (promotable to main page)
  PLAYERS_ONLINE: "players.online",
  PLAYERS_OFFLINE: "players.offline",
  PLAYERS_SEARCH: "players.search",
  PLAYERS_RANKMGR: "players.rankManager",

  // Teleport submenu
  TELEPORT_TP: "teleport.tp",
  TELEPORT_SUMMON: "teleport.summon",
  TELEPORT_WARP: "teleport.tpToWarp",

  // Control Panel submenu
  CONTROL_CONFIG: "control.configEditor",
  CONTROL_ITEMWATCH: "control.itemWatch",
  CONTROL_TICKETSET: "control.ticketSettings",
  CONTROL_DIMLOCKS: "control.dimensionLocks",
  CONTROL_SERVERCTL: "control.serverControls",
  CONTROL_HOLOGRAMS: "control.restoreHolograms",

  // Warps Admin submenu
  WARPS_ADD: "warps.add",
  WARPS_REMOVE: "warps.remove",
  WARPS_STAFFONLY: "warps.toggleStaffOnly",
  WARPS_REORDER: "warps.reorder",
  WARPS_VISIBILITY: "warps.toggleVisible",

  // Broadcasts submenu
  BC_IMMEDIATE: "broadcasts.immediate",
  BC_ADD_SCHED: "broadcasts.addScheduled",
  BC_MANAGE_SCHED: "broadcasts.manageScheduled",
});

// Order in this array IS the order rows render in the customize modal.
// Each row: { key, label, labelKey, perm?, adminOnly?, ownerLayer?, topLevel?, icon? }
//   labelKey: lang key (jm_at.menu.*) for DISPLAY; label stays for logic/compat.
// lang-keys: jm_at.menu.*
//   perm:       string | string[] — modCan key(s) required (matches render-site gate).
//               Array means "any one of these" (passes if some()).
//   adminOnly:  true ⇒ never offered to mods (mirrors isAdmin check on storageHealth/holograms)
//   ownerLayer: true ⇒ exposed in the owner-only Menu Visibility editor (top-level only)
//   topLevel:   true ⇒ row is a top-level admin panel button (default visible).
//               Absent ⇒ row is a sub-button (default NOT promoted to main page).
//   icon:       texture path used when this row is rendered as a promoted shortcut.
export const MENU_BUTTON_META = Object.freeze([
  // Top-level (always shown for staff)
  {
    key: MENU_KEYS.SEARCH,
    label: "Search",
    labelKey: "jm_at.menu.search",
    topLevel: true,
    icon: "textures/ui/jm_at_search_info",
  },
  {
    key: MENU_KEYS.TICKETS,
    label: "Tickets",
    labelKey: "jm_at.menu.tickets",
    perm: "tickets",
    ownerLayer: true,
    topLevel: true,
    icon: "textures/ui/jm_at_tickets",
  },
  {
    key: MENU_KEYS.PLAYERS,
    label: "Players",
    labelKey: "jm_at.menu.players",
    topLevel: true,
    icon: "textures/ui/jm_at_players",
  },
  {
    key: MENU_KEYS.TELEPORT,
    label: "Teleport",
    labelKey: "jm_at.menu.teleport",
    perm: ["tpToPlayer", "summon"],
    ownerLayer: true,
    topLevel: true,
    icon: "textures/ui/jm_at_tp_to",
  },
  {
    key: MENU_KEYS.CONTROL_PANEL,
    label: "Control Panel",
    labelKey: "jm_at.menu.control_panel",
    perm: [
      "serverControls",
      "ticketSettings",
      "dimensionLocks",
      "itemWatch",
      "configEditor",
    ],
    topLevel: true,
    icon: "textures/ui/jm_at_control_panel",
  },
  {
    key: MENU_KEYS.COMMANDS,
    label: "Commands",
    labelKey: "jm_at.menu.commands",
    perm: ["commands", "gameCommands", "gameRules", "gamemode"],
    ownerLayer: true,
    topLevel: true,
    icon: "textures/ui/jm_at_commands",
  },
  {
    key: MENU_KEYS.WARPS,
    label: "Warps",
    labelKey: "jm_at.menu.warps",
    perm: "warps",
    ownerLayer: true,
    topLevel: true,
    icon: "textures/ui/jm_at_warps",
  },
  {
    key: MENU_KEYS.BROADCASTS,
    label: "Broadcasts",
    labelKey: "jm_at.menu.broadcasts",
    perm: "broadcasts",
    ownerLayer: true,
    topLevel: true,
    icon: "textures/ui/jm_at_broadcast",
  },
  {
    key: MENU_KEYS.ADMIN_LOG,
    label: "Admin Log",
    labelKey: "jm_at.menu.admin_log",
    topLevel: true,
    icon: "textures/ui/jm_at_admin_log",
  },
  {
    key: MENU_KEYS.INFO,
    label: "Info",
    labelKey: "jm_at.menu.info",
    topLevel: true,
    icon: "textures/ui/jm_at_admin_info",
  },

  // Players submenu (sub-buttons — promotable to main page)
  {
    key: MENU_KEYS.PLAYERS_ONLINE,
    label: "Players → Online Players",
    labelKey: "jm_at.menu.players_online",
    icon: "textures/ui/jm_at_online",
  },
  {
    key: MENU_KEYS.PLAYERS_OFFLINE,
    label: "Players → Offline Players",
    labelKey: "jm_at.menu.players_offline",
    icon: "textures/ui/jm_at_offline",
  },
  {
    key: MENU_KEYS.PLAYERS_SEARCH,
    label: "Players → Search by Name",
    labelKey: "jm_at.menu.players_search",
    icon: "textures/ui/jm_at_search_info",
  },
  {
    key: MENU_KEYS.PLAYERS_RANKMGR,
    label: "Players → Rank Manager",
    labelKey: "jm_at.menu.players_rankmgr",
    perm: "rankManager",
    icon: "textures/ui/jm_at_rank_manager",
  },

  // Teleport submenu
  {
    key: MENU_KEYS.TELEPORT_TP,
    label: "Teleport → TP to Player",
    labelKey: "jm_at.menu.teleport_tp",
    perm: "tpToPlayer",
    icon: "textures/ui/jm_at_tp_to",
  },
  {
    key: MENU_KEYS.TELEPORT_SUMMON,
    label: "Teleport → Summon Player",
    labelKey: "jm_at.menu.teleport_summon",
    perm: "summon",
    icon: "textures/ui/jm_at_summon",
  },
  {
    key: MENU_KEYS.TELEPORT_WARP,
    label: "Teleport → TP Player to Warp",
    labelKey: "jm_at.menu.teleport_warp",
    perm: "summon",
    icon: "textures/ui/jm_at_warps",
  },

  // Control Panel submenu
  {
    key: MENU_KEYS.CONTROL_CONFIG,
    label: "Control Panel → Config Editor",
    labelKey: "jm_at.menu.control_config",
    perm: "configEditor",
    icon: "textures/ui/jm_at_control_panel",
  },
  {
    key: MENU_KEYS.CONTROL_ITEMWATCH,
    label: "Control Panel → Item Watch",
    labelKey: "jm_at.menu.control_itemwatch",
    perm: "itemWatch",
    icon: "textures/ui/jm_at_item_watch",
  },
  {
    key: MENU_KEYS.CONTROL_TICKETSET,
    label: "Control Panel → Ticket Settings",
    labelKey: "jm_at.menu.control_ticketset",
    perm: "ticketSettings",
    icon: "textures/ui/jm_at_ticket_settings",
  },
  {
    key: MENU_KEYS.CONTROL_DIMLOCKS,
    label: "Control Panel → Dimension Locks",
    labelKey: "jm_at.menu.control_dimlocks",
    perm: "dimensionLocks",
    icon: "textures/ui/jm_at_dimension_lock",
  },
  {
    key: MENU_KEYS.CONTROL_SERVERCTL,
    label: "Control Panel → Server Controls",
    labelKey: "jm_at.menu.control_serverctl",
    perm: "serverControls",
    icon: "textures/ui/jm_at_server_controls",
  },
  {
    key: MENU_KEYS.CONTROL_HOLOGRAMS,
    label: "Control Panel → Restore Holograms",
    labelKey: "jm_at.menu.control_holograms",
    adminOnly: true,
    icon: "textures/ui/jm_at_hologram_tool",
  },

  // Warps Admin submenu
  {
    key: MENU_KEYS.WARPS_ADD,
    label: "Warps → Add Warp",
    labelKey: "jm_at.menu.warps_add",
    perm: "warps",
    icon: "textures/ui/jm_at_add",
  },
  {
    key: MENU_KEYS.WARPS_REMOVE,
    label: "Warps → Remove Warp",
    labelKey: "jm_at.menu.warps_remove",
    perm: "warps",
    icon: "textures/ui/jm_at_remove",
  },
  {
    key: MENU_KEYS.WARPS_STAFFONLY,
    label: "Warps → Set Visibility (public / staff / admin)",
    labelKey: "jm_at.menu.warps_staffonly",
    perm: "warps",
    icon: "textures/ui/jm_at_staff_toggle",
  },
  {
    key: MENU_KEYS.WARPS_REORDER,
    label: "Warps → Reorder Warps",
    labelKey: "jm_at.menu.warps_reorder",
    perm: "warps",
    icon: "textures/ui/jm_at_add_or_remove",
  },
  {
    key: MENU_KEYS.WARPS_VISIBILITY,
    label: "Warps → Hide/Show in Player Menu",
    labelKey: "jm_at.menu.warps_visibility",
    perm: "warps",
    icon: "textures/ui/jm_at_warps",
  },

  // Broadcasts submenu
  {
    key: MENU_KEYS.BC_IMMEDIATE,
    label: "Broadcasts → Send Immediate",
    labelKey: "jm_at.menu.bc_immediate",
    perm: "broadcasts",
    icon: "textures/ui/jm_at_broadcast",
  },
  {
    key: MENU_KEYS.BC_ADD_SCHED,
    label: "Broadcasts → Add Scheduled",
    labelKey: "jm_at.menu.bc_add_sched",
    perm: "broadcasts",
    icon: "textures/ui/jm_at_scheduled_broadcast",
  },
  {
    key: MENU_KEYS.BC_MANAGE_SCHED,
    label: "Broadcasts → Manage Scheduled",
    labelKey: "jm_at.menu.bc_manage_sched",
    perm: "broadcasts",
    icon: "textures/ui/jm_at_manage_broadcast",
  },
]);

/** Subset visible in the owner-only Menu Visibility editor. */
export const OWNER_LAYER_KEYS = Object.freeze(
  MENU_BUTTON_META.filter((m) => m.ownerLayer).map((m) => m.key),
);
