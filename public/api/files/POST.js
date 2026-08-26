import { getSetting, triggerHook } from 'kempo/server/sdk.js';
import { parseMultipart, extractBoundary, storeUpload } from 'kempo-files/sdk';
import { authorizeSpace, requireWritable, hasPermission } from '../../../server/utils/permissions/gate.js';
import { requireWithinSpace } from '../../../server/utils/spaces/scope.js';
import { scheduleRecalculation } from '../../../server/utils/quota/usage.js';

/*
  Uploading into a space.

  This route exists rather than reusing kempo-files' own because the permissions are a different
  shape: that one asks for `files:upload`, which is a licence to write anywhere in the shared
  library. A member of a user space has no such licence — their licence is `userdirs:access`, and
  it is bounded by the folder check below rather than by a permission at all.

  Everything after that is kempo-files': its hooks, its storage, its size limit, its trusted
  handling. Reimplementing any of it here would be a second set of rules to drift out of step with
  the first.
*/
export default async (request, response) => {
  const [authError, context] = await authorizeSpace(request, { userId: request.query?.userId, action: 'manage' });
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [writableError] = requireWritable(context.space);
  if(writableError) return response.status(writableError.code).json({ error: writableError.msg });

  const boundary = extractBoundary(request.headers['content-type']);
  if(!boundary) return response.status(400).json({ error: 'Expected a multipart/form-data upload' });

  /*
    request.buffer() rather than request.body: for a multipart content type kempo-server hands the
    body back decoded as UTF-8, which mangles every byte of a binary file.
  */
  const parts = parseMultipart(await request.buffer(), boundary);

  const filePart = parts.find(part => part.filename);
  if(!filePart) return response.status(400).json({ error: 'No file was included in the upload' });

  const field = name => parts.find(part => part.name === name && !part.filename)?.data.toString('utf8');

  const directoryId = field('directoryId') || context.space.directoryId;
  const [scopeError] = await requireWithinSpace(context.space, directoryId);
  if(scopeError) return response.status(scopeError.code).json({ error: scopeError.msg });

  /*
    Sharing is its own permission, so asking for it without holding it is refused rather than
    quietly downgraded — somebody who thinks they published a link deserves to be told they did not.
  */
  const wantsPublic = field('public') === 'true';
  if(wantsPublic){
    const allowed = context.isSelf
      ? await hasPermission(context.session.token, 'userdirs:share')
      : await hasPermission(context.session.token, 'userdirs:others:manage');
    if(!allowed) return response.status(403).json({ error: 'You cannot share files publicly' });
  }

  /*
    The quota check lives in this hook, not in this route — an administrator uploading through the
    file library's own admin has to hit the same limit. See hooks/file-before-upload.js.
  */
  try {
    await triggerHook('file:before_upload', {
      name: filePart.filename,
      size: filePart.data.length,
      directoryId,
      uploadedBy: context.session.user.id,
      request,
    }, { bail: true });
  } catch(hookError) {
    return response.status(hookError?.code || 403).json({ error: hookError?.msg || 'That upload was refused' });
  }

  const [, maxUploadMb] = await getSetting('kempo-files', 'max_upload_size_mb', 250);

  /*
    Owned by the person whose space it is, not by whoever uploaded it. An administrator putting a
    file into somebody's folder is giving it to them — leaving it owned by the admin would make the
    member unable to touch their own file through kempo-files' own ownership rules.

    `reviewable: false` is the important one. Not merely "unapproved" but *unapprovable*: a
    personal folder is not site content, nobody is ever going to review it, and an admin approving
    a member's uploaded script would let it execute on this site's own origin. kempo-files enforces
    that at every layer — it refuses to grant trust, keeps these out of its Needs review queue, and
    serves them as inert text at the response whatever any flag says.

    So `trusted: false` here is belt and braces; the flag above is what makes it permanent.
  */
  const [storeError, file] = await storeUpload({
    name: filePart.filename,
    data: filePart.data,
    directoryId,
    altText: field('alt') || '',
    ownerId: context.space.userId,
    trusted: false,
    reviewable: false,
    public: wantsPublic,
    maxBytes: Number(maxUploadMb) * 1024 * 1024,
  });
  if(storeError){
    // The hook above already reserved these bytes. Nothing was written, so put the number right.
    scheduleRecalculation(context.space);
    return response.status(storeError.code).json({ error: storeError.msg });
  }

  await triggerHook('file:uploaded', { file });

  response.status(201).json({ file });
};
