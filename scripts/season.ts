/** Headless season run: create a career and play through N seasons, printing a summary. Usage: npx tsx scripts/season.ts [seasons] [seed] */
import { createCareer, defaultOptions } from '../src/engine/career';
import { advanceToNextMatch, playUserMatch } from '../src/engine/game';
import { leagueTable } from '../src/engine/competitions';
import { overall } from '../src/engine/attributes';
import { formatDate } from '../src/engine/dates';
import { acceptOffer, negotiateOffer, proposalOf, rejectOffer } from '../src/engine/transfers';
import { buyItem, invest, resolveLifeDecision } from '../src/engine/life';

const seasons = Number(process.argv[2] ?? 1);
const seed = Number(process.argv[3] ?? 12345);
const t0 = Date.now();
const o = defaultOptions(seed);
o.position = 'ST';
o.pathway = (process.argv[4] as 'youth' | 'lower' | 'established') ?? 'established';
const state = createCareer(o);
console.log(`created in ${Date.now() - t0}ms; players=${Object.keys(state.players).length} json=${(JSON.stringify(state).length / 1e6).toFixed(2)}MB`);
const u = state.players[state.userId];
console.log(`${u.firstName} ${u.lastName} ${u.position} ovr ${Math.round(overall(u))} pot ${u.potential} at ${state.clubs[u.clubId as string].name} (${state.career.squadRole})`);

// transfer policy for the headless user: none | accept | negotiate | reject
const policy = process.argv[5] ?? 'none';
const tally = { offers: 0, permanent: 0, free: 0, loan: 0, extension: 0, accepted: 0, rejected: 0, countered: 0, withdrawn: 0, failed: 0 };
const seen = new Set<string>();
function handleOffers() {
  for (const off of state.transfers.offers.filter((x) => x.status === 'open' || x.status === 'negotiating')) {
    if (!seen.has(off.id)) {
      seen.add(off.id);
      tally.offers++;
      tally[off.kind]++;
    }
    if (policy === 'none') continue;
    if (policy === 'noext' && (off.kind === 'extension' || off.kind === 'loan')) continue; // take moves and free deals, never stay or loan
    if (off.status !== 'open') continue;
    if (policy === 'reject') { rejectOffer(state, off.id); tally.rejected++; continue; }
    if (policy === 'negotiate') {
      let out = negotiateOffer(state, off.id, { ...proposalOf(off), wage: Math.round(off.wage * 1.18) });
      if ('status' in out && out.status === 'countered') tally.countered++;
      if ('status' in out && out.status === 'withdrawn') { tally.withdrawn++; continue; }
      if ('status' in out && out.status === 'rejected') { out = negotiateOffer(state, off.id, { ...proposalOf(off) }); }
    }
    const res = acceptOffer(state, off.id);
    if (res.ok) {
      tally.accepted++;
      console.log(`   accept ${off.kind} ${state.clubs[off.fromClubId].name} wage £${off.wage} fee £${off.fee} :: ${res.message}`);
    } else tally.failed++;
  }
}

// life policy (LIFE=1): answer decisions, spend sensibly, invest a little
const lifeOn = process.env.LIFE === '1';
const lifeTally = { decisions: 0, bought: 0, failedBuys: 0, invested: 0, sponsors: 0 };
let pick = 0;
let lastShop = state.day;
function handleLife() {
  if (!lifeOn) return;
  for (const d of state.decisions.filter((x) => x.kind === 'life' || x.kind === 'sponsor')) {
    const opt = d.options[pick++ % d.options.length];
    const r = resolveLifeDecision(state, d.id, opt.id);
    if (r.ok) lifeTally.decisions++;
  }
  if (state.day - lastShop >= 30) {
    lastShop = state.day;
    for (const id of ['svc_nutritionist', 'svc_physio', 'flat_rent', 'car_used', 'ent_dinner', 'trv_weekend', 'clo_casual', 'house_own', 'car_sports']) {
      const r = buyItem(state, id);
      if (r.ok) lifeTally.bought++; else lifeTally.failedBuys++;
    }
    for (const inv of ['inv_studio', 'inv_cafe', 'inv_startup', 'inv_flats']) {
      if (state.finance.balance > 60000 && invest(state, inv).ok) lifeTally.invested++;
    }
  }
}

let plays = 0;
const t1 = Date.now();
const targetSeason = state.season + seasons;
let guard = 0;
while (state.season < targetSeason && guard++ < 5000) {
  const r = advanceToNextMatch(state);
  handleOffers();
  handleLife();
  if (r.stop === 'match') {
    const res = playUserMatch(state, 'instant');
    if (res) plays++;
    handleOffers();
  } else if (r.stop === 'retired') break;
  if (r.rolled) {
    const s = state.lastSeasonSummary;
    const uu = state.players[state.userId];
    console.log(`-- season ${s?.season} done ${formatDate(state.day)}: pos ${s?.leaguePos} champ ${s?.champion} cup ${s?.cupWinner} promoted=${s?.promoted} relegated=${s?.relegated} apps ${s?.apps} goals ${s?.goals} avg ${s?.avgRating.toFixed(2)} ovr ${Math.round(overall(uu))}/${uu.potential} club ${state.clubs[uu.clubId ?? '']?.name ?? 'FREE AGENT'} balance £${state.finance.balance}`);
  }
}
console.log(`played ${plays} user matches; ${seasons} season(s) in ${Date.now() - t1}ms; day ${formatDate(state.day)}`);
const l1 = state.competitions[`L1-${state.season - 1}`];
if (l1) {
  const t = leagueTable(state, l1.id);
  console.log('Last L1 table:', t.slice(0, 4).map((r) => `${state.clubs[r.clubId].shortName} ${r.pts}`).join(', '), '...', t.slice(-3).map((r) => `${state.clubs[r.clubId].shortName} ${r.pts}`).join(', '));
}
console.log('news', state.news.length, 'ledger', state.finance.ledger.length, 'records', Object.keys(state.matchRecords).length, 'json', (JSON.stringify(state).length / 1e6).toFixed(2), 'MB');
console.log('transfer policy', policy, JSON.stringify(tally), 'rumours', state.transfers.rumours.length, 'scoutReports', state.transfers.scoutReports.length, 'moves', state.career.transfers.length);
if (lifeOn) {
  const f = state.finance;
  console.log('life', JSON.stringify(lifeTally), 'rep', JSON.stringify(state.reputation), 'userRep', state.players[state.userId].reputation);
  console.log('relationships', state.relationships.map((r) => `${r.kind}:${r.name.split(' ')[0]}=${r.value}`).join(', '));
  console.log('housing', f.housing, 'purchases', f.purchases.length, 'balance', f.balance, 'careerEarnings', f.careerEarnings, 'sponsors', f.sponsorships.map((s) => `${s.brand}/${s.status}/${s.paid}`).join(';'));
  console.log('investments', f.investments.map((i) => `${i.name}:${i.status}:cost${i.cost}->val${i.value}+inc${i.incomeTotal}`).join(' | '));
  console.log('pending decisions', state.decisions.length, 'ledger cats', JSON.stringify([...new Set(f.ledger.map((e) => e.category))]));
}
console.log('career apps', state.career.appearances.apps, 'goals', state.career.appearances.goals, 'achievements', Object.keys(state.career.achievements).join(','));
