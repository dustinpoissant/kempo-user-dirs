import crypto from 'crypto';
import { asc, eq, ne } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoUserDirPlan, kempoUserDir } from '../../db/schema.js';

/*
  Storage plans: the named allowances a space can be put on.

  Exactly one plan is the default at any time, and setting a new one clears the old — enforced here
  rather than by a constraint, because "at most one row where isDefault" is not something Postgres
  expresses without a partial unique index that would then have to be created outside the schema
  file kempo generates tables from.
*/

export const listPlans = async () => {
  try {
    const plans = await db.select().from(kempoUserDirPlan).orderBy(asc(kempoUserDirPlan.name));
    return [null, { plans }];
  } catch {
    return [{ code: 500, msg: 'Could not list the storage plans' }, null];
  }
};

export const getPlan = async id => {
  if(!id) return [{ code: 400, msg: 'A plan id is required' }, null];

  try {
    const [plan] = await db.select().from(kempoUserDirPlan).where(eq(kempoUserDirPlan.id, id));
    if(!plan) return [{ code: 404, msg: 'Storage plan not found' }, null];
    return [null, plan];
  } catch {
    return [{ code: 500, msg: 'Could not load the storage plan' }, null];
  }
};

/*
  The plan a space falls back to when it names none of its own. A site that has deleted every plan
  gets `null`, which every quota calculation reads as unlimited — the same answer as the shipped
  default plan, so losing the row is not the same as locking everyone out.
*/
export const defaultPlan = async () => {
  try {
    const [plan] = await db.select().from(kempoUserDirPlan).where(eq(kempoUserDirPlan.isDefault, true));
    return [null, plan || null];
  } catch {
    return [{ code: 500, msg: 'Could not load the default storage plan' }, null];
  }
};

export const createPlan = async ({ name, description = '', quotaBytes = null, isDefault = false }) => {
  const [nameError, validName] = planName(name);
  if(nameError) return [nameError, null];

  const [quotaError, limit] = quotaValue(quotaBytes);
  if(quotaError) return [quotaError, null];

  try {
    const [taken] = await db.select().from(kempoUserDirPlan).where(eq(kempoUserDirPlan.name, validName));
    if(taken) return [{ code: 409, msg: `A plan called "${validName}" already exists` }, null];

    const now = new Date();
    const row = {
      id: crypto.randomBytes(8).toString('hex'),
      name: validName,
      description: String(description || ''),
      quotaBytes: limit,
      isDefault: Boolean(isDefault),
      createdAt: now,
      updatedAt: now,
    };

    if(row.isDefault) await db.update(kempoUserDirPlan).set({ isDefault: false, updatedAt: now });
    await db.insert(kempoUserDirPlan).values(row);

    return [null, row];
  } catch {
    return [{ code: 500, msg: 'Could not create the storage plan' }, null];
  }
};

export const updatePlan = async ({ id, name, description, quotaBytes, isDefault }) => {
  const [lookupError, existing] = await getPlan(id);
  if(lookupError) return [lookupError, null];

  const changes = {};

  if(name !== undefined && name !== existing.name){
    const [nameError, validName] = planName(name);
    if(nameError) return [nameError, null];

    const [taken] = await db.select().from(kempoUserDirPlan).where(eq(kempoUserDirPlan.name, validName));
    if(taken && taken.id !== id) return [{ code: 409, msg: `A plan called "${validName}" already exists` }, null];
    changes.name = validName;
  }

  if(description !== undefined) changes.description = String(description || '');

  if(quotaBytes !== undefined){
    const [quotaError, limit] = quotaValue(quotaBytes);
    if(quotaError) return [quotaError, null];
    changes.quotaBytes = limit;
  }

  if(isDefault !== undefined) changes.isDefault = Boolean(isDefault);

  if(!Object.keys(changes).length) return [null, existing];

  try {
    const now = new Date();
    if(changes.isDefault){
      await db.update(kempoUserDirPlan).set({ isDefault: false, updatedAt: now }).where(ne(kempoUserDirPlan.id, id));
    }
    await db.update(kempoUserDirPlan).set({ ...changes, updatedAt: now }).where(eq(kempoUserDirPlan.id, id));
    return [null, { ...existing, ...changes }];
  } catch {
    return [{ code: 500, msg: 'Could not save the storage plan' }, null];
  }
};

/*
  Deleting a plan does not delete anybody's files, and does not silently change what they are
  allowed to store either — the spaces on it are moved to the default plan explicitly, which is the
  only outcome that is both visible and reversible.

  The default plan itself cannot be deleted while another exists to be made default first. Removing
  the fallback out from under every space that relies on it is the kind of change that should take
  two deliberate steps.
*/
export const deletePlan = async ({ id }) => {
  const [lookupError, existing] = await getPlan(id);
  if(lookupError) return [lookupError, null];

  try {
    if(existing.isDefault){
      const [other] = await db.select().from(kempoUserDirPlan).where(ne(kempoUserDirPlan.id, id));
      if(other) return [{ code: 409, msg: 'Make another plan the default before deleting this one' }, null];
    }

    const moved = await db.update(kempoUserDir)
      .set({ planId: null, updatedAt: new Date() })
      .where(eq(kempoUserDir.planId, id))
      .returning({ id: kempoUserDir.id });

    await db.delete(kempoUserDirPlan).where(eq(kempoUserDirPlan.id, id));

    return [null, { id, spacesMoved: moved.length }];
  } catch {
    return [{ code: 500, msg: 'Could not delete the storage plan' }, null];
  }
};

const planName = name => {
  const trimmed = String(name ?? '').trim();
  if(!trimmed) return [{ code: 400, msg: 'A plan name is required' }, null];
  if(trimmed.length > 60) return [{ code: 400, msg: 'Plan names cannot be longer than 60 characters' }, null];
  return [null, trimmed];
};

/*
  null and '' both mean unlimited — the admin form sends an empty input for it, and a caller
  clearing a limit in JSON sends null. Zero is a real answer (a space that may hold nothing), so it
  is deliberately not folded in with them.
*/
const quotaValue = value => {
  if(value === null || value === undefined || value === '') return [null, null];

  const bytes = Number(value);
  if(!Number.isFinite(bytes) || bytes < 0) return [{ code: 400, msg: 'A storage limit must be zero or more bytes' }, null];
  if(!Number.isSafeInteger(bytes)) return [{ code: 400, msg: 'That storage limit is too large to record' }, null];

  return [null, bytes];
};
