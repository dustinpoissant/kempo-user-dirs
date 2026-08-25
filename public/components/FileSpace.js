import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Dropdown.js';
import '/kempo-ui/components/Progress.js';
import '/my-files/components/QuotaMeter.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import formatBytes from '/my-files/utils/formatBytes.js';
import { promptForValue, promptForChoice } from '/my-files/utils/prompts.js';
import {
  getSpace, listEntries, listFolders,
  createDirectory, updateDirectory, deleteDirectory,
  uploadFile, updateFile, deleteFile,
  urlForFile, publicUrlForFile,
} from '/my-files/sdk.js';

/*
  The whole file space, as one element.

  It is deliberately the *same* element on the member's own page and on the admin's screen for
  somebody else's space — the only difference is the `user-id` attribute, and every route behind it
  already knows that reaching another person's space needs `userdirs:others:*`. Two components would
  have meant two sets of upload handling, two rename flows and two chances for the admin copy to
  quietly allow something the member's copy did not.

  It owns the API calls and the navigation state. Anything with a life of its own — the quota
  meter — is a sibling element.
*/

const KIND_ICON = {
  image: 'image', video: 'video', audio: 'audio', model3d: 'model3d',
  archive: 'archive', font: 'font', document: 'file-text', text: 'code', other: 'file',
};

export default class FileSpace extends ShadowComponent {
  static properties = {
    userId: { type: String, attribute: 'user-id' },
    space: { state: true },
    entries: { state: true },
    search: { state: true },
    loading: { state: true },
    uploads: { state: true },
    dragging: { state: true },
    error: { state: true },
  };

  constructor(){
    super();
    this.userId = '';
    this.space = null;
    this.entries = null;
    this.search = '';
    this.loading = true;
    this.uploads = [];
    this.dragging = false;
    this.error = '';
    this.directoryId = null;
  }

  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  /*
    Data
  */

  get scope(){
    return this.userId ? { userId: this.userId } : {};
  }

  load = async () => {
    this.loading = true;
    this.error = '';

    const [spaceError, spaceData] = await getSpace(this.scope);
    if(spaceError){
      this.loading = false;
      this.error = spaceError.msg;
      return;
    }

    this.space = spaceData.space;
    await this.loadEntries();
    this.loading = false;
  };

  loadEntries = async () => {
    const [error, data] = await listEntries({
      ...this.scope,
      directoryId: this.directoryId || undefined,
      search: this.search || undefined,
    });

    if(error){
      this.error = error.msg;
      return;
    }

    this.entries = data;
    this.directoryId = data.directoryId;
  };

  /*
    Reloads the usage figure as well as the listing. Anything that changes what is stored changes
    how full the space is, and a meter that only updates on a full page load is a meter people stop
    believing.
  */
  refresh = async () => {
    const [, spaceData] = await getSpace(this.scope);
    if(spaceData) this.space = spaceData.space;
    await this.loadEntries();
  };

  navigate = directoryId => async () => {
    this.directoryId = directoryId;
    this.search = '';
    await this.loadEntries();
  };

  handleSearch = event => {
    clearTimeout(this.searchTimer);
    const value = event.target.value;
    this.searchTimer = setTimeout(() => {
      this.search = value;
      this.loadEntries();
    }, 250);
  };

  /*
    Uploading
  */

  handleFiles = async fileList => {
    const files = [...fileList];
    if(!files.length) return;

    /*
      Sequential rather than parallel. Each upload buffers in memory server-side, and a member
      dropping in a folder of video would otherwise ask the process to hold all of it at once — and
      would race every one of them against the same quota reservation.
    */
    for(const file of files){
      const entry = { name: file.name, loaded: 0, total: file.size };
      this.uploads = [...this.uploads, entry];

      const [error] = await uploadFile(file, {
        ...this.scope,
        directoryId: this.directoryId,
        onProgress: (loaded, total) => {
          entry.loaded = loaded;
          entry.total = total;
          this.uploads = [...this.uploads];
        },
      });

      this.uploads = this.uploads.filter(candidate => candidate !== entry);

      if(error){
        Toast.error(`${file.name}: ${error.msg}`);
        // A refused upload is almost always the quota, so show the new number rather than the old.
        await this.refresh();
        return;
      }
    }

    Toast.success(files.length === 1 ? 'Uploaded' : `Uploaded ${files.length} files`);
    await this.refresh();
  };

  handlePicked = event => {
    this.handleFiles(event.target.files);
    event.target.value = '';   // so picking the same file twice still fires a change
  };

  handleDrop = event => {
    event.preventDefault();
    this.dragging = false;
    if(this.space?.canWrite) this.handleFiles(event.dataTransfer.files);
  };

  handleDragOver = event => {
    event.preventDefault();
    if(this.space?.canWrite) this.dragging = true;
  };

  handleDragLeave = event => {
    if(event.target === event.currentTarget) this.dragging = false;
  };

  /*
    Actions
  */

  newFolder = async () => {
    const name = await promptForValue('New folder', { placeholder: 'Folder name', confirmText: 'Create' });
    if(!name) return;

    const [error] = await createDirectory(name, { ...this.scope, parentId: this.directoryId });
    if(error) return Toast.error(error.msg);

    Toast.success('Folder created');
    await this.loadEntries();
  };

  rename = (kind, entry) => async () => {
    const name = await promptForValue(`Rename ${kind === 'folder' ? 'folder' : 'file'}`, {
      value: entry.name,
      confirmText: 'Rename',
    });
    if(!name || name === entry.name) return;

    const [error] = kind === 'folder'
      ? await updateDirectory({ id: entry.id, name }, this.scope)
      : await updateFile({ id: entry.id, name }, this.scope);
    if(error) return Toast.error(error.msg);

    await this.loadEntries();
  };

  move = (kind, entry) => async () => {
    const [foldersError, data] = await listFolders(this.scope);
    if(foldersError) return Toast.error(foldersError.msg);

    /*
      A folder cannot be moved into itself or anything below it. kempo-files refuses that anyway,
      but offering the choice and then rejecting it is a worse way to be told.
    */
    const forbidden = kind === 'folder' ? descendantsOf(data.folders, entry.id) : new Set();

    const options = data.folders
      .filter(folder => folder.id !== entry.id && !forbidden.has(folder.id))
      .map(folder => ({ value: folder.id, label: folder.path }));

    if(!options.length) return Toast.error('There is nowhere else to move it to');

    const destination = await promptForChoice(`Move "${entry.name}" to…`, options, { value: this.directoryId });
    if(!destination || destination === this.directoryId) return;

    const [error] = kind === 'folder'
      ? await updateDirectory({ id: entry.id, parentId: destination }, this.scope)
      : await updateFile({ id: entry.id, directoryId: destination }, this.scope);
    if(error) return Toast.error(error.msg);

    Toast.success('Moved');
    await this.loadEntries();
  };

  toggleShared = file => async () => {
    const [error, data] = await updateFile({ id: file.id, public: !file.public }, this.scope);
    if(error) return Toast.error(error.msg);

    if(data.file.public){
      const link = `${location.origin}${publicUrlForFile(data.file)}`;
      Dialog.alert(html`
        <p>Anyone with this link can now download <strong>${file.name}</strong>.</p>
        <input type="text" class="full mt" readonly .value=${link} @focus=${event => event.target.select()} />
      `, { title: 'Share link' });
    } else {
      Toast.success('Sharing turned off');
    }

    await this.loadEntries();
  };

  remove = (kind, entry) => async () => {
    const confirmed = await Dialog.confirm(
      kind === 'folder'
        ? html`<p>Delete the folder <strong>${entry.name}</strong>? It has to be empty first.</p>`
        : html`<p>Delete <strong>${entry.name}</strong>? This cannot be undone.</p>`,
      { title: 'Delete', confirmText: 'Delete', confirmClasses: 'danger ml' },
    );
    if(!confirmed) return;

    const [error] = kind === 'folder'
      ? await deleteDirectory(entry.id, this.scope)
      : await deleteFile(entry.id, this.scope);
    if(error) return Toast.error(error.msg);

    Toast.success('Deleted');
    await this.refresh();
  };

  /*
    Rendering
  */

  render(){
    if(this.loading) return html`<p class="tc-muted">Loading your files…</p>`;
    if(this.error && !this.space) return html`<p class="tc-danger">${this.error}</p>`;
    if(!this.space) return html``;

    return html`
      <div
        class="space ${this.dragging ? 'dragging' : ''}"
        @dragover=${this.handleDragOver}
        @dragleave=${this.handleDragLeave}
        @drop=${this.handleDrop}
      >
        <!--
          Property bindings, not attributes. An attribute is always a string, so a null limit —
          which is what "unlimited" is, everywhere in this extension — arrives as "" and a Number
          converter turns that into 0. An unlimited space would then draw a full meter reading
          "0 B of 0 B used".
        -->
        <k-udirs-quota-meter
          class="mb"
          .bytesUsed=${this.space.bytesUsed}
          .limitBytes=${this.space.limitBytes}
          .planName=${this.space.limitFromOverride ? 'Custom limit' : (this.space.plan?.name || '')}
          .suspended=${this.space.suspended}
        ></k-udirs-quota-meter>

        ${this.renderToolbar()}
        ${this.renderBreadcrumb()}
        ${this.uploads.length ? this.renderUploads() : ''}
        ${this.renderListing()}
      </div>
    `;
  }

  renderToolbar(){
    return html`
      <div class="d-f toolbar mb">
        <input
          class="flex"
          type="search"
          placeholder="Search this folder…"
          .value=${this.search}
          @input=${this.handleSearch}
        />
        ${this.space.canWrite ? html`
          <button class="btn" @click=${this.newFolder}>
            <k-icon name="create_new_folder"></k-icon> New folder
          </button>
          <label class="btn primary upload">
            <k-icon name="upload"></k-icon> Upload
            <input type="file" multiple @change=${this.handlePicked} />
          </label>
        ` : ''}
      </div>
    `;
  }

  renderBreadcrumb(){
    return html`
      <nav class="d-f crumbs mb">
        ${(this.entries?.breadcrumb || []).map((crumb, index, all) => html`
          ${index ? html`<span class="tc-muted">/</span>` : ''}
          ${index === all.length - 1
            ? html`<span class="current">${crumb.name}</span>`
            : html`<button class="no-btn link" @click=${this.navigate(crumb.id)}>${crumb.name}</button>`}
        `)}
      </nav>
    `;
  }

  renderUploads(){
    return html`
      <div class="uploads mb">
        ${this.uploads.map(upload => html`
          <div class="upload-row">
            <span class="name">${upload.name}</span>
            <k-progress percentage=${upload.total ? Math.round((upload.loaded / upload.total) * 100) : 0}></k-progress>
          </div>
        `)}
      </div>
    `;
  }

  renderListing(){
    const directories = this.entries?.directories || [];
    const files = this.entries?.files || [];

    if(!directories.length && !files.length){
      return html`
        <p class="tc-muted empty">
          ${this.search
            ? 'Nothing here matches that.'
            : this.space.canWrite
              ? 'This folder is empty. Drop files anywhere on it, or use Upload.'
              : 'This folder is empty.'}
        </p>
      `;
    }

    return html`
      <ul class="listing">
        ${directories.map(directory => html`
          <li class="row">
            <k-icon name="folder" class="glyph tc-muted"></k-icon>
            <button class="no-btn link name" @click=${this.navigate(directory.id)}>${directory.name}</button>
            <span class="meta tc-muted">Folder</span>
            ${this.renderMenu('folder', directory)}
          </li>
        `)}

        ${files.map(file => html`
          <li class="row">
            <k-icon name=${KIND_ICON[file.kind] || 'file'} class="glyph tc-muted"></k-icon>
            <a class="name" href=${urlForFile(file, this.scope)} target="_blank" rel="noopener">${file.name}</a>
            <span class="meta tc-muted">
              ${formatBytes(file.sizeBytes)}
              ${file.public ? html`<k-icon name="link" title="Shared with anyone who has the link"></k-icon>` : ''}
            </span>
            ${this.renderMenu('file', file)}
          </li>
        `)}
      </ul>
    `;
  }

  renderMenu(kind, entry){
    const canWrite = this.space.canWrite;
    if(!canWrite && kind === 'folder') return html`<span class="menu-space"></span>`;

    return html`
      <k-dropdown open-direction="left">
        <button slot="trigger" class="no-btn menu-trigger" title="Actions"><k-icon name="more_vert"></k-icon></button>
        ${kind === 'file' ? html`
          <button @click=${() => window.open(urlForFile(entry, this.scope), '_blank', 'noopener')}>
            <k-icon name="download"></k-icon> Download
          </button>
        ` : ''}
        ${canWrite ? html`
          <button @click=${this.rename(kind, entry)}><k-icon name="edit"></k-icon> Rename…</button>
          <button @click=${this.move(kind, entry)}><k-icon name="drive_file_move"></k-icon> Move to…</button>
        ` : ''}
        ${kind === 'file' && this.space.canShare ? html`
          <button @click=${this.toggleShared(entry)}>
            <k-icon name="link"></k-icon> ${entry.public ? 'Stop sharing' : 'Share a link…'}
          </button>
        ` : ''}
        <button class="tc-danger" @click=${this.remove(kind, entry)}><k-icon name="delete"></k-icon> Delete…</button>
      </k-dropdown>
    `;
  }

  static styles = css`
    :host { display: block; }
    .space { position: relative; border-radius: var(--radius); transition: outline-color var(--animation_ms); outline: 2px dashed transparent; outline-offset: var(--spacer_h); }
    .space.dragging { outline-color: var(--c_primary); }
    .toolbar { gap: var(--spacer_h); align-items: center; flex-wrap: wrap; }
    .upload { position: relative; overflow: hidden; cursor: pointer; }
    .upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .crumbs { align-items: center; gap: var(--spacer_q); flex-wrap: wrap; }
    .crumbs .current { font-weight: 600; }
    .listing { list-style: none; margin: 0; padding: 0; }
    .row { display: flex; align-items: center; gap: var(--spacer_h); padding: var(--spacer_h) 0; border-bottom: 1px solid var(--c_border); }
    .row .glyph { font-size: 1.4rem; }
    .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
    .row .meta { display: flex; align-items: center; gap: var(--spacer_q); white-space: nowrap; font-size: 0.9em; }
    .menu-space { display: inline-block; min-width: 2rem; }
    .menu-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2rem;
      min-height: 2rem;
      background: transparent;
      border: 1px solid var(--c_border);
      border-radius: var(--radius);
      padding: var(--spacer_h);
      color: inherit;
      cursor: pointer;
    }
    .menu-trigger:hover { background: oklch(from var(--c_bg__inv) l c h / 0.15); }
    .uploads .upload-row { margin-bottom: var(--spacer_h); }
    .uploads .name { display: block; font-size: 0.9em; }
    .empty { padding: var(--spacer) 0; }
  `;
}

/*
  Every folder below `id`, so a move never offers a destination inside the thing being moved.
*/
const descendantsOf = (folders, id) => {
  const found = new Set([id]);
  let changed = true;

  while(changed){
    changed = false;
    for(const folder of folders){
      if(folder.parentId && found.has(folder.parentId) && !found.has(folder.id)){
        found.add(folder.id);
        changed = true;
      }
    }
  }

  return found;
};

customElements.define('k-udirs-file-space', FileSpace);
