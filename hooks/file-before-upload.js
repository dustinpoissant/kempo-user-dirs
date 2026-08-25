import { stat } from 'fs/promises';
import { getFile, filePath } from 'kempo-files/sdk';
import { resolveSpace } from '../server/utils/spaces/scope.js';
import { describeSpace } from '../server/utils/spaces/spaces.js';
import { wouldExceed } from '../server/utils/quota/limits.js';
import { reserveBytes } from '../server/utils/quota/usage.js';
import formatBytes from '../server/utils/formatBytes.js';

/*
  The quota gate — and the reason it lives in a hook rather than in this extension's upload route.

  A user space is an ordinary kempo-files folder, so an administrator can upload into one from the
  file library's own admin, and kempo-thumbs writes generated thumbnails next to the files it made
  them from. Both of those are real bytes landing in somebody's space. If the limit were enforced
  only on the route this extension owns, either would walk straight past it.

  kempo-files fires `file:before_upload` for every upload it accepts, whatever route it arrived at,
  and a handler blocks by throwing `{ code }`. So the check goes here, once, and covers all of them.
*/
export default async ({ size, directoryId, replacing }) => {
  const [scopeError, space] = await resolveSpace(directoryId);
  if(scopeError || !space) return;   // not in anybody's space — none of our business

  if(space.suspended){
    throw { code: 403, msg: 'This file space is suspended and cannot accept new files' };
  }

  const described = await describeSpace(space);
  if(described.limitBytes === null) return;

  /*
    Replacing a file frees its current bytes. Counting only the difference is what stops a
    re-upload of an unchanged file from failing on a space that is merely full rather than
    over-full.
  */
  const freed = replacing ? await currentSize(replacing) : 0;
  const additional = Math.max(0, Number(size || 0) - freed);

  if(wouldExceed(described.limitBytes, described.bytesUsed, additional)){
    throw {
      code: 413,
      msg: `That would put this space over its ${formatBytes(described.limitBytes)} storage limit (${formatBytes(described.bytesUsed)} used)`,
    };
  }

  /*
    Reserve before returning. Two uploads arriving together would otherwise both measure against
    the same cached figure and both be allowed through — see server/utils/quota/usage.js for why
    the cache is deliberately pessimistic until the recalculation after the upload corrects it.
  */
  await reserveBytes(space, additional);
};

const currentSize = async id => {
  const [fileError, file] = await getFile(id);
  if(fileError) return 0;

  const [pathError, absolute] = await filePath(file);
  if(pathError) return 0;

  try {
    return (await stat(absolute)).size;
  } catch {
    return 0;
  }
};
