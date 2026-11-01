/**
 * Headless check of the end of a career. Starts an ageing custom player and answers every retirement decision with one
 * policy. Usage: npx tsx scripts/retire.ts [policy: continue|reduced|lower|abroad|retire|mixed] [seed] [startAge]
 */
import { createCareer, defaultOptions } from '../src/engine/career';
import { advanceToNextMatch, playUserMatch, resolveDecision } from '../src/engine/game';
import { overall } from '../src/engine/attributes';
import { formatDate } from '../src/engine/dates';
import { acceptOffer } from '../src/engine/transfers';
import { retirementSummaryText } from '../src/engine/retirement';

const policy = process.argv[2] ?? 'mixed';
const seed = Number(process.argv[3] ?? 4242);
const startAge = Number(process.argv[4] ?? 33);
const o = defaultOptions(seed);
o.pathway = 'custom';
o.age = startAge;
o.position = 'CM';
o.custom = { ovr: Number(process.argv[5] ?? 63), talent: 'good' };
const state = createCareer(o);
const u = state.players[state.userId];
console.log(`start: ${u.displayName} age ${startAge} ${u.position} ovr ${Math.round(overall(u))} at ${state.clubs[u.clubId as string].name}`);

const mixedOrder = ['continue', 'reduced', 'lower', 'abroad', 'continue_abroad', 'return', 'retire'];
let n = 0;
let guard = 0;
const log: string[] = [];
while (!state.career.retired && guard++ < 4000) {
  const r = advanceToNextMatch(state);
  for (const d of state.decisions.filter((x) => x.kind === 'retirement')) {
    const want = policy === 'mixed' ? mixedOrder[n++ % mixedOrder.length] : policy;
    const opt = d.options.find((x) => x.id === want) ?? d.options.find((x) => x.id === 'retire') ?? d.options[0];
    const res = resolveDecision(state, d.id, opt.id);
    log.push(`${formatDate(state.day)} age ${Math.floor((state.day - state.players[state.userId].birthDay) / 365.25)} options [${d.options.map((x) => x.id).join(',')}] chose ${opt.id}: ${res.message}`);
  }
  // take any offer from a club (stepping down creates them)
  for (const off of state.transfers.offers.filter((x) => x.status === 'open')) {
    if (state.flags.stepDown !== undefined && off.kind !== 'extension') { const res = acceptOffer(state, off.id); if (res.ok) { log.push(`  accepted ${off.kind} ${state.clubs[off.fromClubId].name}`); break; } }
  }
  if (r.stop === 'match') playUserMatch(state, 'instant');
  if (state.career.retired) break;
}
console.log(log.join('\n'));
const l = state.career.legacy;
console.log('retired:', state.career.retired, 'day', formatDate(state.day));
if (l) {
  console.log(retirementSummaryText(l).join('\n'));
  console.log('clubs:', l.clubs.map((c) => `${c.clubName} ${c.firstSeason}-${c.lastSeason} (${c.apps}/${c.goals})`).join('; '));
  console.log('best season:', JSON.stringify(l.bestSeason), 'best spell:', l.bestSpell?.clubName);
  console.log('timeline entries', l.timeline.length, 'first', l.timeline[0]?.title, 'last', l.timeline[l.timeline.length - 1]?.title);
  console.log('verdict', l.verdict, '-', l.verdictDetail);
}
console.log('seasons', state.career.seasons.map((s) => `${s.season}:${s.clubName}:${s.league.apps + s.cup.apps}`).join(' '));
