/*
  One formatter, both sides.

  The canonical implementation lives in `public/utils/formatBytes.js` because that is the copy that
  has to be *served* — the browser cannot import out of `server/`. Node can import in the other
  direction perfectly well, so the server takes its copy from there rather than keeping a second
  one.

  It matters that these agree. "That would put this space over its 5 GB limit" comes from the
  server; the meter the user is looking at while they read it comes from the browser. Two
  implementations of the same rounding is how those end up saying different numbers about the same
  space.

  Nothing HTTP-shaped crosses this line — it is a pure function of a number, which is the only kind
  of thing worth sharing this way.
*/
export { default, toBytes, splitBytes, UNITS } from '../../public/utils/formatBytes.js';
