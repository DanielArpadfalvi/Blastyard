/**
 * Simulation version. Bump for every change that alters simulation results (state layout,
 * movement rules, RNG usage order…), then update golden hashes and re-validate every built-in
 * challenge solution in the same change.
 *
 * History:
 * - 1: state model, arena generation, movement (T1.1–T1.3).
 * - 2: bombs, flames, chains, pickups, deaths (T1.4); countdown, round timer, spiral sudden
 *      death, ghosts, teams, rounds/match and rules in the state header (T1.5).
 */
export const SIM_VERSION = 2;
