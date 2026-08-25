import { getUserById } from 'kempo/server/sdk.js';
import { authorizeSpace, hasPermission } from '../../../server/utils/permissions/gate.js';
import { describeSpace } from '../../../server/utils/spaces/spaces.js';
import { remainingBytes } from '../../../server/utils/quota/limits.js';
import { isUsageStale, scheduleRecalculation } from '../../../server/utils/quota/usage.js';
import { readConfig } from '../../../server/utils/config/settings.js';

/*
  Everything a screen needs before it draws anything: whose space this is, how full it is, and
  which controls the viewer is allowed to be shown.

  The `can*` flags are for drawing, not deciding. Every one of them is checked again on the route
  that would act on it — a hidden button is a courtesy, never the boundary.
*/
export default async (request, response) => {
  const [error, context] = await authorizeSpace(request, { userId: request.query?.userId });
  if(error) return response.status(error.code).json({ error: error.msg });

  const { session, space, isSelf } = context;
  const described = await describeSpace(space);

  /*
    Opening a space is the natural moment to notice the cached figure has gone stale — a file
    removed from disk by hand, or a recalculation lost to a restart. It is scheduled rather than
    awaited, so the page draws with the number it has and corrects itself on the next load.
  */
  const { usageStaleMinutes } = await readConfig();
  if(isUsageStale(space, usageStaleMinutes)) scheduleRecalculation(space);

  const [, user] = await getUserById(space.userId);

  response.json({
    space: {
      userId: space.userId,
      directoryId: space.directoryId,
      bytesUsed: described.bytesUsed,
      limitBytes: described.limitBytes,
      remainingBytes: remainingBytes(described.limitBytes, described.bytesUsed),
      usageCalculatedAt: space.usageCalculatedAt,
      suspended: space.suspended,
      plan: described.plan ? { id: described.plan.id, name: described.plan.name, quotaBytes: described.plan.quotaBytes } : null,
      /*
        Whether the limit came from a per-user override rather than from the plan. Without it a
        screen showing both would say "10 KB used of 10 KB" next to the word "Unlimited" — the
        plan's name, still perfectly true and completely baffling.
      */
      limitFromOverride: space.quotaOverrideBytes !== null && space.quotaOverrideBytes !== undefined,
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      isSelf,
      canWrite: !space.suspended && (isSelf || await hasPermission(session.token, 'userdirs:others:manage')),
      canShare: isSelf
        ? await hasPermission(session.token, 'userdirs:share')
        : await hasPermission(session.token, 'userdirs:others:manage'),
    },
  });
};
