import DashboardWidget from '/kempo/components/DashboardWidget.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import { getSpace } from '/my-files/sdk.js';
const formatBytes = bytes => {
  if(bytes === null || bytes === undefined) return '\u2014';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while(value >= 1024 && unit < units.length - 1){
    value /= 1024;
    unit++;
  }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
};

/*
  The signed-in user's own file space: what is used, the limit their plan allows and the plan's name.
*/
export default class SpaceWidget extends DashboardWidget {
  static properties = {
    ...DashboardWidget.properties,
    space: { state: true }
  };

  constructor(){
    super();
    this.space = null;
    this.cta = { label: 'Browse my files', icon: 'folder', href: '/admin/extension/kempo-user-dirs/browse' };
  }

  /*
    Public Methods
  */

  load = async () => {
    this.space = (await this.unwrap(getSpace())).space;
  };

  /*
    Rendering
  */

  renderContent(){
    const { bytesUsed, limitBytes, plan, suspended } = this.space;
    if(!bytesUsed) return html`<p class="tc-muted mb0">No files yet.</p><div class="small tc-muted">${plan?.name ? `${plan.name} plan` : ''}${limitBytes === null ? '' : ` \u00b7 ${formatBytes(limitBytes)} available`}</div>`;
    return html`
      <div class="h2 m0">${formatBytes(bytesUsed)}${limitBytes === null ? '' : html` <span class="small tc-muted">of ${formatBytes(limitBytes)}</span>`}</div>
      ${limitBytes === null ? html`<div class="small tc-muted">No limit</div>` : html`<progress class="full" max=${limitBytes} value=${Math.min(bytesUsed, limitBytes)}></progress>`}
      <div class="small tc-muted mtq">${plan?.name ? `${plan.name} plan` : ''}</div>
      ${suspended ? html`<p class="tc-danger mtq" role="alert">This space is suspended.</p>` : nothing}
    `;
  }
}

customElements.define('k-udirs-widget', SpaceWidget);
