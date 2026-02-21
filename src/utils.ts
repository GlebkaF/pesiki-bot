import { MSK_OFFSET_HOURS } from "./constants.js";

/**
 * Gets current MSK time components using UTC methods.
 * By adding MSK offset to UTC time and using getUTC* methods,
 * we correctly get MSK time regardless of server timezone.
 */
export function getMskTimeComponents() {
  const now = new Date();
  const mskTime = now.getTime() + MSK_OFFSET_HOURS * 60 * 60 * 1000;
  const mskDate = new Date(mskTime);

  return {
    year: mskDate.getUTCFullYear(),
    month: mskDate.getUTCMonth(),
    date: mskDate.getUTCDate(),
    hours: mskDate.getUTCHours(),
    day: mskDate.getUTCDay(),
  };
}
