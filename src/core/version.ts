/**
 * Simulation version. Bump for every change that alters simulation results (state layout,
 * movement rules, RNG usage order…), then update golden hashes and re-validate every built-in
 * challenge solution in the same change.
 *
 * History:
 * - 1: state model, arena generation, movement (T1.1–T1.3).
 * - 2: bombs, flames, chains, pickups, deaths (T1.4); countdown, round timer, spiral sudden
 *      death, ghosts, teams, rounds/match and rules in the state header (T1.5).
 * - 3: power-ups (kick, toss, pierce, shield, max flame, jinx) and bot AI (T4.1, T4.2).
 * - 4: per-cell floor layers (ice, belts, teleports, tunnels, trampolines, growing pillars) and
 *      the seat / header fields they need (T4.3). Every state hash changes because the buffer
 *      layout changed; classic arenas play exactly as in 3.
 */
export const SIM_VERSION = 4;
