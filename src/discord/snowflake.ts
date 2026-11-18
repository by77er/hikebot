/** Discord's epoch, the first millisecond of 2015, in Unix milliseconds. */
export const DISCORD_EPOCH_MS = 1_420_070_400_000;

/**
 * When Discord created the object with this snowflake id, in milliseconds
 * since the Unix epoch. An interaction's id gives the time of the
 * interaction, so handlers can measure ages without reading the clock.
 */
export function snowflakeTime(id: string): number {
  return Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS;
}

/**
 * The smallest snowflake created at `time` (Unix milliseconds): an id that
 * `snowflakeTime` reads back as `time`.
 */
export function snowflakeAt(time: number): string {
  return String(BigInt(time - DISCORD_EPOCH_MS) << 22n);
}
