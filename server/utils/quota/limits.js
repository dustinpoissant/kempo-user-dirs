/*
  How many bytes a space is allowed, given its row and the plan behind it.

  Two sources, one precedence rule, no arithmetic: a per-user override replaces the plan's number
  outright rather than adding to it. "Plan says 10GB, this person gets 25GB" is a sentence anyone
  can check against a screen; "plan plus bonus minus adjustment" is not, and the second time
  somebody has to work out why a user is at 37GB the design has already failed.

  `null` means unlimited, all the way through. It is the shipped default, and every caller has to
  handle it anyway — so it is the same answer for "no plan", "plan with no cap" and "site that
  deleted all its plans", rather than three different ones that each need their own branch.
*/
export const effectiveLimit = (space, plan) => {
  if(space?.quotaOverrideBytes !== null && space?.quotaOverrideBytes !== undefined) return space.quotaOverrideBytes;
  if(plan?.quotaBytes !== null && plan?.quotaBytes !== undefined) return plan.quotaBytes;
  return null;
};

/*
  Whether `additionalBytes` more would fit. Split out from the check itself so the upload hook, the
  space summary and the tests all ask the same question the same way.
*/
export const wouldExceed = (limitBytes, bytesUsed, additionalBytes) => {
  if(limitBytes === null || limitBytes === undefined) return false;
  return Number(bytesUsed || 0) + Number(additionalBytes || 0) > limitBytes;
};

export const remainingBytes = (limitBytes, bytesUsed) => {
  if(limitBytes === null || limitBytes === undefined) return null;
  return Math.max(0, limitBytes - Number(bytesUsed || 0));
};
