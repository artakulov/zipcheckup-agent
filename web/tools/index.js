import { lookupZip } from './lookup-zip.js';
import { compareZips } from './compare-zips.js';
import { explainMetric } from './explain-metric.js';
import { findSaferZips } from './find-safer-zips.js';
import { updateShortlist } from './update-shortlist.js';

export { lookupZip, compareZips, explainMetric, findSaferZips, updateShortlist };

// Order matters: it is the order an agent sees them in, and the order the
// console lists them. Read tools first, write tool last.
export const ALL_TOOLS = [lookupZip, compareZips, explainMetric, findSaferZips, updateShortlist];
