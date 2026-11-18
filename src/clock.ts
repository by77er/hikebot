/**
 * The system clock, for code that has no `PollStore` to take its clock from,
 * such as the web routes. Pass it on as a `now: () => number`; nothing else
 * reads the clock.
 */
export const systemNow = (): number => Date.now();
