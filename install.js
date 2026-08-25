import { listPlans, createPlan } from './server/utils/plans/plans.js';

/*
  One thing that cannot be declared: the default storage plan.

  kempo's declarative config creates permissions, settings, groups and tables — not rows in an
  extension's own tables. Without a default plan every space would fall through to "no plan", which
  the quota code reads as unlimited anyway, so the feature would still work. Shipping the row
  regardless is what gives an admin something to *edit* rather than something to first discover
  they need to create — and it makes the answer to "why is this unlimited?" a plan on screen with a
  blank limit rather than an absence.

  Idempotent, like everything else in an install: a reinstall that finds any plan leaves them alone
  rather than adding a second Unlimited.
*/
export default async () => {
  const [error, data] = await listPlans();
  if(error){
    console.warn(`[kempo-user-dirs] Could not check for existing storage plans: ${error.msg}`);
    return;
  }

  if(data.plans.length) return;

  const [createError] = await createPlan({
    name: 'Unlimited',
    description: 'No storage limit. The plan every space falls back to until a site decides on tiers.',
    quotaBytes: null,
    isDefault: true,
  });

  if(createError){
    console.warn(`[kempo-user-dirs] Could not create the default storage plan: ${createError.msg}`);
    return;
  }

  console.log('[kempo-user-dirs] Created the "Unlimited" default storage plan. Nobody has a file space until they are added to the kempo-user-dirs:member group.');
};
