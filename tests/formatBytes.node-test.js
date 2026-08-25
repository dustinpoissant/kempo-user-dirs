import formatBytes, { toBytes, splitBytes } from '../server/utils/formatBytes.js';

/*
  The formatter is imported by both the server and the browser through the same file, so these
  cases cover the numbers a user is shown *and* the numbers quoted back to them in an error.
*/

export default {
  'null formats as unlimited rather than as a number': async ({ pass, fail }) => {
    /*
      null travels all the way from the schema to the screen meaning "no limit". Rendering it as
      "0 B" or "—" would tell a member with unlimited storage that they have none.
    */
    if(formatBytes(null) !== 'Unlimited') return fail(`got ${formatBytes(null)}`);
    if(formatBytes(undefined) !== 'Unlimited') return fail(`got ${formatBytes(undefined)}`);
    pass('null and undefined read as Unlimited');
  },

  'zero is zero, not unlimited': async ({ pass, fail }) => {
    if(formatBytes(0) !== '0 B') return fail(`got ${formatBytes(0)}`);
    pass('zero bytes formats as 0 B');
  },

  'scales to the unit a person would use': async ({ pass, fail }) => {
    const cases = [
      [512, '512 B'],
      [1500, '1.5 KB'],
      [1_000_000, '1 MB'],
      [10_000_000_000, '10 GB'],
    ];

    for(const [bytes, expected] of cases){
      const actual = formatBytes(bytes);
      if(actual !== expected) return fail(`${bytes} formatted as ${actual}, expected ${expected}`);
    }
    pass('units and rounding match how storage is described');
  },

  'toBytes and splitBytes round-trip a plan limit': async ({ pass, fail }) => {
    /*
      The admin form takes a limit apart into an amount and a unit to display it, and puts it back
      together to save it. If those two disagree, opening a plan and pressing Save without touching
      anything silently changes what it allows.
    */
    for(const bytes of [1000, 1_500_000, 10_000_000_000, 250_000_000]){
      const { amount, unit } = splitBytes(bytes);
      const back = toBytes(amount, unit);
      if(back !== bytes) return fail(`${bytes} became ${amount} ${unit} and came back as ${back}`);
    }
    pass('a limit survives a trip through the admin form unchanged');
  },

  'splitBytes leaves unlimited blank rather than zero': async ({ pass, fail }) => {
    const { amount } = splitBytes(null);
    if(amount !== '') return fail(`expected a blank amount, got ${JSON.stringify(amount)}`);
    pass('an unlimited plan shows an empty field');
  },

  'toBytes refuses nonsense instead of producing a limit': async ({ pass, fail }) => {
    /*
      A silently-coerced NaN would be written to the database as a limit nothing can satisfy.
    */
    if(toBytes('abc', 'GB') !== null) return fail('non-numeric input should produce null');
    if(toBytes(-5, 'GB') !== null) return fail('a negative amount should produce null');
    if(toBytes(5, 'ZB') !== null) return fail('an unknown unit should produce null');
    pass('bad input produces null, never a number');
  },
};
