import { effectiveLimit, wouldExceed, remainingBytes } from '../server/utils/quota/limits.js';

/*
  The quota arithmetic, in isolation.

  Every case here is a way somebody could end up with the wrong amount of storage. `null` meaning
  unlimited is the one that matters most: it travels through three layers as an ordinary value, and
  a single `||` anywhere along the way would turn "unlimited" into "zero bytes" — a space that
  refuses every upload, for a member who was told they had no limit.
*/

export default {
  'no plan and no override is unlimited': async ({ pass, fail }) => {
    if(effectiveLimit({ quotaOverrideBytes: null }, null) !== null){
      return fail('a space with nothing set should be unlimited');
    }
    pass('unlimited by default');
  },

  'a plan with no limit is still unlimited': async ({ pass, fail }) => {
    if(effectiveLimit({ quotaOverrideBytes: null }, { quotaBytes: null }) !== null){
      return fail('a plan with a null quota should not impose one');
    }
    pass('a plan can be unlimited');
  },

  'the plan applies when there is no override': async ({ pass, fail }) => {
    const limit = effectiveLimit({ quotaOverrideBytes: null }, { quotaBytes: 5000 });
    if(limit !== 5000) return fail(`expected 5000, got ${limit}`);
    pass('the plan sets the limit');
  },

  'an override replaces the plan rather than adding to it': async ({ pass, fail }) => {
    /*
      The whole reason overrides are a replacement: "plan 10GB, override 25GB" has to mean 25, not
      35. Anyone checking a screen against a bill needs the number on the space to be the number.
    */
    const limit = effectiveLimit({ quotaOverrideBytes: 25000 }, { quotaBytes: 10000 });
    if(limit !== 25000) return fail(`expected the override (25000), got ${limit}`);
    pass('an override wins outright');
  },

  'an override of zero is a real limit, not an absent one': async ({ pass, fail }) => {
    /*
      Zero is falsy, so any `override || plan` implementation reads "this space may hold nothing"
      as "this space has no override" and silently hands back the plan's allowance instead.
    */
    const limit = effectiveLimit({ quotaOverrideBytes: 0 }, { quotaBytes: 10000 });
    if(limit !== 0) return fail(`expected 0, got ${limit} — zero was treated as unset`);
    pass('zero is honoured');
  },

  'an unlimited space never exceeds anything': async ({ pass, fail }) => {
    if(wouldExceed(null, 999999999, 999999999)) return fail('null should mean no limit');
    pass('unlimited accepts any upload');
  },

  'exactly filling the limit is allowed': async ({ pass, fail }) => {
    /*
      An off-by-one here refuses the upload that would fit precisely — which is exactly the upload
      somebody makes after deleting something to make room, and the one they will complain about.
    */
    if(wouldExceed(1000, 900, 100)) return fail('900 + 100 into a 1000 limit should fit');
    if(!wouldExceed(1000, 900, 101)) return fail('900 + 101 into a 1000 limit should not fit');
    pass('the boundary is inclusive');
  },

  'remaining bytes never goes negative': async ({ pass, fail }) => {
    /*
      A space can legitimately be over its limit — an admin lowered the plan, or a thumbnail landed
      after the last check. A negative "remaining" would draw a meter backwards and read as a
      negative allowance rather than as full.
    */
    if(remainingBytes(1000, 1500) !== 0) return fail('an over-full space should report 0 remaining');
    if(remainingBytes(null, 1500) !== null) return fail('unlimited should report null remaining');
    if(remainingBytes(1000, 250) !== 750) return fail('expected 750 remaining');
    pass('remaining is clamped at zero');
  },
};
