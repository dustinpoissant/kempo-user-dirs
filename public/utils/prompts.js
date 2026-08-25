import { html } from '/kempo-ui/lit-all.min.js';
import Dialog from '/kempo-ui/components/Dialog.js';

/*
  kempo-ui's Dialog ships confirm/alert/error but nothing that collects a value, so these build one
  out of its public create() rather than window.prompt — which blocks the whole page and cannot be
  styled. Both resolve to null when dismissed, so a caller can treat "cancelled" and "left empty"
  the same way.
*/
export const promptForValue = (title, { value = '', placeholder = '', confirmText = 'Save', help = '' } = {}) =>
  new Promise(resolve => {
    let settled = false;
    const settle = result => { if(!settled){ settled = true; resolve(result); } };

    const $dialog = Dialog.create(html`
      <div class="p">
        <input type="text" class="full" .value=${value} placeholder=${placeholder} />
        ${help ? html`<p class="mt small tc-muted">${help}</p>` : ''}
      </div>
    `, {
      title,
      closeBtn: false,
      overlayClose: false,
      confirmText,
      confirmClasses: 'primary ml',
      confirmAction: () => settle($dialog.querySelector('input').value.trim()),
      cancelText: 'Cancel',
      cancelAction: () => settle(null),
      closeCallback: () => settle(null),
    });

    setTimeout(() => $dialog.querySelector('input')?.focus(), 0);
  });

export const promptForChoice = (title, options, { confirmText = 'Move', value = '' } = {}) =>
  new Promise(resolve => {
    let settled = false;
    const settle = result => { if(!settled){ settled = true; resolve(result); } };

    const $dialog = Dialog.create(html`
      <div class="p">
        <select class="full">
          ${options.map(option => html`
            <option value=${option.value} ?selected=${option.value === value}>${option.label}</option>
          `)}
        </select>
      </div>
    `, {
      title,
      closeBtn: false,
      overlayClose: false,
      confirmText,
      confirmClasses: 'primary ml',
      confirmAction: () => settle($dialog.querySelector('select').value),
      cancelText: 'Cancel',
      cancelAction: () => settle(null),
      closeCallback: () => settle(null),
    });
  });
