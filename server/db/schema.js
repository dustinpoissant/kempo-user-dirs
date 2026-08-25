import { pgTable, text, boolean, bigint, timestamp } from 'drizzle-orm/pg-core';

/*
  Two tables, and neither of them stores a file.

  Every byte a user uploads is an ordinary kempo-files row in an ordinary folder on disk — that is
  the whole point of building on top of it rather than beside it. Files inherit kempo-files'
  serving rules, its trusted/untrusted handling, its download hook and its `files/` placement for
  free. What is recorded here is only the part kempo-files has no opinion about: which folder
  belongs to which person, and how much they are allowed to put in it.
*/

/*
  A named storage allowance that many users can share.

  A per-user number alone would have been enough to enforce a limit, but not to sell one: changing
  what "Free" means would mean rewriting a column across every row that had it, and there would be
  nowhere to describe the tier to the person buying it. A plan is the row an ecommerce extension
  points at — grant someone `Pro` and their limit moves with the plan.

  `quotaBytes` null means unlimited. That is the shipped default, so the feature works out of the
  box as "private space, no cap" and a site turns limits on when it has a reason to.
*/
export const kempoUserDirPlan = pgTable('kempoUserDirPlan', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  quotaBytes: bigint('quotaBytes', { mode: 'number' }),   // null = unlimited
  isDefault: boolean('isDefault').notNull().default(false),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
});

/*
  One row per user who actually has a space.

  Its existence *is* the entitlement record. Holding `userdirs:access` is what makes a user
  eligible for a space; this row is the space they were given. Keeping those separate is what lets
  the permission be revoked (subscription lapsed) without destroying anything, and what lets an
  admin see who is using storage without trawling group membership.

  `directoryId` points at a kempo-files folder rather than a path. Paths move — a folder rename
  upstream would silently detach every space from its contents — while the id is what kempo-files
  itself goes by.
*/
export const kempoUserDir = pgTable('kempoUserDir', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().unique(),   // no FK — matches kempo-files' ownerId convention
  directoryId: text('directoryId').notNull(),  // the kempo-files folder that is this user's root

  planId: text('planId'),                                     // null = whichever plan is the default
  quotaOverrideBytes: bigint('quotaOverrideBytes', { mode: 'number' }),  // beats the plan; null = use it

  /*
    Cached, never authoritative. The real number is what is on disk, and recalculating it is a
    filesystem walk — cheap enough to do after a change, far too expensive to do on every page
    that wants to draw a usage bar. See server/utils/quota/usage.js for how the two are kept
    honest: uploads reserve against this value up front, and a walk corrects it straight after.
  */
  bytesUsed: bigint('bytesUsed', { mode: 'number' }).notNull().default(0),
  usageCalculatedAt: timestamp('usageCalculatedAt'),

  /*
    Read-only rather than gone. A lapsed subscription should not delete anybody's files — it should
    stop them adding more while they decide whether to renew. Downloads and deletes keep working;
    uploads, renames and new folders do not.
  */
  suspended: boolean('suspended').notNull().default(false),

  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
});
