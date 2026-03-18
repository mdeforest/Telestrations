/**
 * Deterministic chain routing for Telestrations.
 *
 * Returns the seat index (0-based) of the player who should author
 * the given pass for the given book owner.
 *
 * Even N: (ownerSeat + passNumber - 1) % N
 * Odd N:  (ownerSeat + passNumber) % N
 *
 * Even N: chain length = N; owner draws their own book on pass 1.
 * Odd N:  chain length = N-1; owner writes the prompt but does NOT draw.
 */
export function chainRouter(
  ownerSeat: number,
  passNumber: number,
  playerCount: number
): number {
  if (playerCount % 2 === 0) {
    return (ownerSeat + passNumber - 1) % playerCount;
  } else {
    return (ownerSeat + passNumber) % playerCount;
  }
}

/** Chain length for a given player count. */
export function chainLength(playerCount: number): number {
  return playerCount % 2 === 0 ? playerCount : playerCount - 1;
}

/** Entry type for a given pass number (1-indexed). Alternates drawing→guess. */
export function entryType(passNumber: number): "drawing" | "guess" {
  return passNumber % 2 === 1 ? "drawing" : "guess";
}
