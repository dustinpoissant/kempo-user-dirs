/*
  Browser client, served at /my-files/sdk.js.

  Mirrors the server SDK's names so a call reads the same on either side, and returns the same
  [error, data] tuples the rest of kempo uses.

  Every call takes an optional `userId`. Left off it means "my space"; passed, it means somebody
  else's, which the routes allow only for a caller holding the matching `userdirs:others:*`
  permission. That is what lets the admin screens and the member's own page share one client and
  one set of components rather than growing two of everything.
*/

const BASE = '/my-files/api';

const request = async (path, options = {}) => {
  try {
    const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if(!response.ok) return [{ code: response.status, msg: data.error || response.statusText }, null];
    return [null, data];
  } catch(error) {
    return [{ code: 0, msg: error.message }, null];
  }
};

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const query = params => {
  const search = new URLSearchParams();
  for(const [key, value] of Object.entries(params)){
    if(value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

/*
  Where a file in a space is fetched from.

  Deliberately this extension's route rather than kempo-files' canonical one: a member holds no
  `files:download`, so the library's own URL answers them 403 for their own private file. A file
  they have shared is reachable at both.
*/
export const urlForFile = (file, { userId } = {}) => `${BASE}/files/${file.id}${query({ userId })}`;

export const publicUrlForFile = file => (file.public ? `/kempo-files/api/files/${file.id}` : null);

export const getSpace = ({ userId } = {}) => request(`/space${query({ userId })}`);

export const listEntries = (params = {}) => request(`/entries${query(params)}`);

export const listFolders = ({ userId } = {}) => request(`/folders${query({ userId })}`);

export const createDirectory = (name, { parentId, userId } = {}) =>
  request(`/directories${query({ userId })}`, json('POST', { name, parentId }));

export const updateDirectory = (changes, { userId } = {}) =>
  request(`/directories${query({ userId })}`, json('PATCH', changes));

export const deleteDirectory = (id, { userId } = {}) =>
  request(`/directories${query({ userId })}`, json('DELETE', { id }));

export const updateFile = (changes, { userId } = {}) =>
  request(`/files${query({ userId })}`, json('PATCH', changes));

export const deleteFile = (id, { userId } = {}) =>
  request(`/files${query({ userId })}`, json('DELETE', { id }));

export const setFileShared = (id, shared, { userId } = {}) =>
  updateFile({ id, public: Boolean(shared) }, { userId });

/*
  Uploads go as multipart so the bytes are never base64'd or decoded as text on the way through.

  XMLHttpRequest rather than fetch: fetch exposes no upload-progress event, and a personal file
  space is exactly the place somebody uploads something big enough to want a progress bar for.
  onProgress is optional, so every other call site is unaffected.
*/
export const uploadFile = (file, { directoryId, alt, public: isPublic, userId, onProgress } = {}) => new Promise(resolve => {
  const form = new FormData();
  form.append('file', file, file.name);
  if(directoryId) form.append('directoryId', directoryId);
  if(alt) form.append('alt', alt);
  if(isPublic) form.append('public', 'true');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${BASE}/files${query({ userId })}`);
  xhr.withCredentials = true;

  if(onProgress){
    xhr.upload.addEventListener('progress', event => {
      if(event.lengthComputable) onProgress(event.loaded, event.total);
    });
  }

  xhr.addEventListener('load', () => {
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch { /* an empty or non-JSON body still resolves below */ }
    if(xhr.status < 200 || xhr.status >= 300) resolve([{ code: xhr.status, msg: data.error || xhr.statusText }, null]);
    else resolve([null, data]);
  });

  xhr.addEventListener('error', () => resolve([{ code: 0, msg: 'Network error' }, null]));

  xhr.send(form);
});

export const replaceFileContent = (id, file, { userId } = {}) => {
  const form = new FormData();
  form.append('file', file, file.name);
  return request(`/files/${id}/content${query({ userId })}`, { method: 'PUT', body: form });
};

/*
  Administration
*/

export const listSpaces = () => request('/spaces');

export const provisionSpace = (userId, planId = null) => request('/spaces', json('POST', { userId, planId }));

export const updateSpace = changes => request('/spaces', json('PATCH', changes));

export const deprovisionSpace = (userId, { deleteFiles = false } = {}) =>
  request('/spaces', json('DELETE', { userId, deleteFiles }));

export const recalculateUsage = (userId = null) => request('/spaces/recalculate', json('POST', { userId }));

export const findEligibleUsers = (q = '') => request(`/eligible${query({ q })}`);

export const listPlans = () => request('/plans');

export const createPlan = plan => request('/plans', json('POST', plan));

export const updatePlan = plan => request('/plans', json('PATCH', plan));

export const deletePlan = id => request('/plans', json('DELETE', { id }));
