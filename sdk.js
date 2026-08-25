/*
  Server-side entry point, for hooks and other extensions that want to reach user spaces in process
  rather than over HTTP. The browser-facing client is public/sdk.js, served at /my-files/sdk.js.

  This is the surface an ecommerce extension builds on. Selling storage is three calls and no files:
  `provisionSpace` when somebody subscribes, `updateSpace` to move them onto a plan or hand them a
  one-off allowance, and `updateSpace({ suspended: true })` when a payment lapses. Nothing here
  deletes anything, which is deliberate — a billing failure should never be able to.

  As in kempo-files, these are the *data* operations, with no permission checks of their own: the
  routes are what enforce who may do what. Anything calling in here is server-side code that has
  already decided it is allowed.
*/

export {
  getSpace,
  listSpaces,
  describeSpace,
  provisionSpace,
  updateSpace,
  deprovisionSpace,
  emptySpace,
  spacesForDirectories,
} from './server/utils/spaces/spaces.js';

export { resolveSpace, resolveSpaceForFile, requireWithinSpace, requireFileWithinSpace } from './server/utils/spaces/scope.js';
export { rootDirectory, SYSTEM_OWNER } from './server/utils/spaces/rootDirectory.js';

export { listPlans, getPlan, defaultPlan, createPlan, updatePlan, deletePlan } from './server/utils/plans/plans.js';

export { effectiveLimit, wouldExceed, remainingBytes } from './server/utils/quota/limits.js';
export { measureSpace, recalculateUsage, reserveBytes, scheduleRecalculation, isUsageStale, flushRecalculations } from './server/utils/quota/usage.js';

export { default as listEntries } from './server/utils/entries/listEntries.js';
export { default as formatBytes, toBytes, splitBytes, UNITS } from './server/utils/formatBytes.js';
export { readConfig, normaliseRootFolder, DEFAULTS } from './server/utils/config/settings.js';
