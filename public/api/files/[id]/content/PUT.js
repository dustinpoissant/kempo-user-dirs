import { getSetting, triggerHook } from 'kempo/server/sdk.js';
import { parseMultipart, extractBoundary, getFile, replaceFileContent } from 'kempo-files/sdk';
import { authorizeSpace, requireWritable } from '../../../../../server/utils/permissions/gate.js';
import { requireFileWithinSpace } from '../../../../../server/utils/spaces/scope.js';
import { scheduleRecalculation } from '../../../../../server/utils/quota/usage.js';

/*
  Replacing a file's bytes while keeping its id, name and every link pointing at it — the "save
  over it" half of a personal folder, as opposed to uploading a second copy under a new name.

  `replacing` is passed to the upload hook so the quota check counts only the difference: a file
  that grows by a kilobyte should not need a kilobyte's *whole size* free to be saved.
*/
export default async (request, response) => {
  const [authError, context] = await authorizeSpace(request, { userId: request.query?.userId, action: 'manage' });
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [writableError] = requireWritable(context.space);
  if(writableError) return response.status(writableError.code).json({ error: writableError.msg });

  const [lookupError, existing] = await getFile(request.params?.id);
  if(lookupError) return response.status(lookupError.code).json({ error: lookupError.msg });

  const [scopeError] = await requireFileWithinSpace(context.space, existing);
  if(scopeError) return response.status(scopeError.code).json({ error: scopeError.msg });

  const boundary = extractBoundary(request.headers['content-type']);
  if(!boundary) return response.status(400).json({ error: 'Expected a multipart/form-data upload' });

  const parts = parseMultipart(await request.buffer(), boundary);
  const filePart = parts.find(part => part.filename);
  if(!filePart) return response.status(400).json({ error: 'No file was included' });

  try {
    await triggerHook('file:before_upload', {
      name: existing.name,
      size: filePart.data.length,
      directoryId: existing.directoryId,
      uploadedBy: context.session.user.id,
      replacing: existing.id,
      request,
    }, { bail: true });
  } catch(hookError) {
    return response.status(hookError?.code || 403).json({ error: hookError?.msg || 'That upload was refused' });
  }

  const [, maxUploadMb] = await getSetting('kempo-files', 'max_upload_size_mb', 250);

  /*
    Never trusted, whoever is writing. The file's `reviewable: false` flag (set at upload) already
    makes approval impossible, and replaceFileContent leaves that flag alone — so this only has to
    say that a content swap never *grants* anything either.
  */
  const [error, file] = await replaceFileContent({
    id: existing.id,
    data: filePart.data,
    actorHasTrustedUpload: false,
    maxBytes: Number(maxUploadMb) * 1024 * 1024,
  });
  if(error){
    scheduleRecalculation(context.space);
    return response.status(error.code).json({ error: error.msg });
  }

  await triggerHook('file:uploaded', { file, replaced: true });

  response.json({ file });
};
