import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/Icon.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import formatBytes, { toBytes, splitBytes, UNITS } from '/my-files/utils/formatBytes.js';
import { listPlans, createPlan, updatePlan, deletePlan } from '/my-files/sdk.js';

/*
  The storage plans, edited in place.

  Limits are entered as an amount plus a unit rather than a byte count, because nobody sells
  10000000000 bytes and nobody checks a number that long for a missing zero. An empty amount means
  unlimited — the same thing `null` means everywhere else in this extension — which is why the
  field is left blank rather than defaulted to something.

  Exactly one plan is the default, and the radio column says so: it is the plan every space falls
  back to when it names none of its own, so a site that only ever wants one number sets it here and
  never touches a space again.
*/
export default class PlanEditor extends ShadowComponent {
  static properties = {
    plans: { state: true },
    loading: { state: true },
  };

  constructor(){
    super();
    this.plans = [];
    this.loading = true;
  }

  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  load = async () => {
    this.loading = true;
    const [error, data] = await listPlans();
    this.loading = false;

    if(error) return Toast.error(error.msg || 'Could not load the storage plans');
    this.plans = data.plans;
    this.dispatchEvent(new CustomEvent('plans-changed', { detail: { plans: this.plans }, bubbles: true, composed: true }));
  };

  add = async () => {
    const [error] = await createPlan({ name: uniqueName(this.plans), quotaBytes: null });
    if(error) return Toast.error(error.msg);
    await this.load();
  };

  save = plan => async event => {
    const row = event.target.closest('.plan');
    const amount = row.querySelector('.amount').value.trim();
    const unit = row.querySelector('.unit').value;

    const [error] = await updatePlan({
      id: plan.id,
      name: row.querySelector('.name').value.trim(),
      description: row.querySelector('.description').value.trim(),
      quotaBytes: amount === '' ? null : toBytes(amount, unit),
    });
    if(error) return Toast.error(error.msg);

    Toast.success('Saved');
    await this.load();
  };

  makeDefault = plan => async () => {
    const [error] = await updatePlan({ id: plan.id, isDefault: true });
    if(error) return Toast.error(error.msg);
    await this.load();
  };

  remove = plan => async () => {
    const confirmed = await Dialog.confirm(
      html`
        <p>Delete the <strong>${plan.name}</strong> plan?</p>
        <p class="small tc-muted">
          Nobody's files are touched. Any space on this plan moves to the default plan, which may
          change what it is allowed to store.
        </p>
      `,
      { title: 'Delete plan', confirmText: 'Delete', confirmClasses: 'danger ml' },
    );
    if(!confirmed) return;

    const [error, result] = await deletePlan(plan.id);
    if(error) return Toast.error(error.msg);

    Toast.success(result.spacesMoved
      ? `Deleted. ${result.spacesMoved} space${result.spacesMoved === 1 ? '' : 's'} moved to the default plan.`
      : 'Deleted');
    await this.load();
  };

  render(){
    if(this.loading) return html`<p class="tc-muted">Loading plans…</p>`;

    return html`
      ${this.plans.length ? '' : html`
        <p class="tc-muted">
          No storage plans. Every space is unlimited until one exists and is made the default.
        </p>
      `}

      ${this.plans.map(plan => {
        const { amount, unit } = splitBytes(plan.quotaBytes);
        return html`
          <div class="plan">
            <div class="d-f fields">
              <label class="d-b">
                <span class="small tc-muted d-b">Name</span>
                <input type="text" class="name" .value=${plan.name} />
              </label>

              <label class="d-b flex">
                <span class="small tc-muted d-b">Description</span>
                <input type="text" class="description" .value=${plan.description} placeholder="Shown to nobody yet — for your own reference" />
              </label>

              <label class="d-b">
                <span class="small tc-muted d-b">Limit</span>
                <div class="d-f limit">
                  <input type="number" class="amount" min="0" step="any" .value=${amount} placeholder="Unlimited" />
                  <select class="unit">
                    ${UNITS.map(candidate => html`<option value=${candidate} ?selected=${candidate === unit}>${candidate}</option>`)}
                  </select>
                </div>
              </label>
            </div>

            <div class="d-f actions">
              <label class="d-f default">
                <input type="radio" name="default-plan" ?checked=${plan.isDefault} @change=${this.makeDefault(plan)} />
                <span class="small">Default${plan.isDefault ? '' : html` <span class="tc-muted">— use for spaces with no plan</span>`}</span>
              </label>
              <span class="flex"></span>
              <span class="small tc-muted">${formatBytes(plan.quotaBytes)}</span>
              <button class="btn small" @click=${this.save(plan)}>Save</button>
              <button class="btn small danger" @click=${this.remove(plan)}><k-icon name="delete"></k-icon></button>
            </div>
          </div>
        `;
      })}

      <button class="btn mt" @click=${this.add}><k-icon name="add"></k-icon> Add a plan</button>
    `;
  }

  static styles = css`
    :host { display: block; }
    .plan { border: 1px solid var(--c_border); border-radius: var(--radius); padding: var(--spacer); margin-bottom: var(--spacer); }
    .fields { gap: var(--spacer); align-items: flex-end; flex-wrap: wrap; }
    .limit { gap: var(--spacer_q); }
    .limit .amount { width: 7rem; }
    .limit .unit { width: auto; }
    .actions { gap: var(--spacer_h); align-items: center; margin-top: var(--spacer_h); flex-wrap: wrap; }
    .default { gap: var(--spacer_q); align-items: center; }
  `;
}

const uniqueName = plans => {
  const base = 'New plan';
  if(!plans.some(plan => plan.name === base)) return base;

  let index = 2;
  while(plans.some(plan => plan.name === `${base} ${index}`)) index++;
  return `${base} ${index}`;
};

customElements.define('k-udirs-plan-editor', PlanEditor);
