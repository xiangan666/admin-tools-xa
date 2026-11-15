/** Home identity survives coordinate edits; deleting/recreating uses a fresh ID. */
export function makeHomeAt(previous, coords, icon, idFactory) {
  return {
    ...(previous ?? {}),
    ...coords,
    icon: icon ?? previous?.icon,
    destinationId: previous ? (previous.destinationId || "legacy") : idFactory(),
  };
}

export function validDestinationName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 30 &&
    !/[\u0000-\u001f\u007f]/.test(name) &&
    !["__proto__", "prototype", "constructor"].includes(name);
}
