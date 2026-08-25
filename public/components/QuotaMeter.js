import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Progress.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import formatBytes from '/my-files/utils/formatBytes.js';

/*
  How full a space is.

  An unlimited space gets a sentence rather than a bar at 0% — a meter that can never move is
  visual noise pretending to be information, and it makes "unlimited" look like "empty", which are
  very different things to be told about your storage.
*/
export default class QuotaMeter extends ShadowComponent {
  static properties = {
    bytesUsed: { type: Number, attribute: 'bytes-used' },
    limitBytes: { type: Number, attribute: 'limit-bytes' },
    planName: { type: String, attribute: 'plan-name' },
    suspended: { type: Boolean },
    compact: { type: Boolean },
  };

  constructor(){
    super();
    this.bytesUsed = 0;
    this.limitBytes = null;
    this.planName = '';
    this.suspended = false;
    this.compact = false;
  }

  get percentage(){
    if(!this.limitBytes) return 0;
    return Math.min(100, Math.round((this.bytesUsed / this.limitBytes) * 100));
  }

  /*
    Amber before red, and both well short of full. Somebody who only finds out at 100% has already
    had an upload refused; the point of the colour is to be seen before that happens.
  */
  get colour(){
    if(this.suspended) return 'var(--c_warning, orange)';
    if(this.percentage >= 95) return 'var(--c_danger, red)';
    if(this.percentage >= 80) return 'var(--c_warning, orange)';
    return 'var(--c_primary)';
  }

  render(){
    const unlimited = this.limitBytes === null || this.limitBytes === undefined;

    return html`
      <div class="meter ${this.compact ? 'compact' : ''}">
        <div class="d-f labels">
          <span class="used">
            ${formatBytes(this.bytesUsed)}${unlimited ? '' : html` of ${formatBytes(this.limitBytes)}`} used
          </span>
          <span class="flex"></span>
          ${this.planName ? html`<span class="small tc-muted">${this.planName}</span>` : ''}
        </div>

        ${unlimited
          ? html`<p class="small tc-muted unlimited">No storage limit on this space.</p>`
          : html`<k-progress percentage=${this.percentage} color=${this.colour}></k-progress>`}

        ${this.suspended ? html`
          <p class="small suspended">
            <k-icon name="lock"></k-icon>
            Suspended — existing files can still be downloaded and deleted, but nothing new can be added.
          </p>
        ` : ''}
      </div>
    `;
  }

  static styles = css`
    :host { display: block; }
    .labels { align-items: baseline; gap: var(--spacer_h); margin-bottom: var(--spacer_q); }
    .used { font-weight: 600; }
    .compact .used { font-weight: 400; font-size: 0.9em; }
    .unlimited, .suspended { margin: var(--spacer_q) 0 0; }
    .suspended { color: var(--c_warning, orange); display: flex; align-items: center; gap: var(--spacer_q); }
  `;
}

customElements.define('k-udirs-quota-meter', QuotaMeter);
