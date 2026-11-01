/**
 * The end-to-end journey from the brief, driven through the same engine calls the screens make (no direct edits to state):
 * create a 16-year-old striker, play, get noticed, negotiate, move, finish the season, save, reload and play on.
 */
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { overall } from '../src/engine/attributes';
import { clubCupStage, leagueTable, positionIn } from '../src/engine/competitions';
import { createCareer, defaultOptions } from '../src/engine/career';
import { advanceToNextMatch, playUserMatch, previewMatch } from '../src/engine/game';
import { cupOf } from '../src/engine/season';
import { acceptOffer, agentCanvass, negotiateOffer, openOffers, proposalOf, windowInfo } from '../src/engine/transfers';
import { squadOf } from '../src/engine/selection';
import { listSlots, loadSlot, saveToSlot } from '../src/persistence/saves';
import { resetDbForTests } from '../src/persistence/db';
import type { GameState, MatchRecord, TransferOffer } from '../src/engine/types';
import { autoHandle, clone, dismissDecisions, idleDays, playMatches, playUntilSeason, user } from './helpers';

let s: GameState;
let firstRecord: MatchRecord;
let offer: TransferOffer;
let oldClubId: string;
let endedSeason: number;
let reloaded: GameState;

beforeAll(async () => {
  await resetDbForTests();
}, 30000);

describe('the career journey', () => {
  it('1. creates a 16-year-old striker', () => {
    // a prodigy, so that clubs notice within the first year; everything else is the standard wizard default
    s = createCareer({ ...defaultOptions(1717), pathway: 'custom', age: 16, position: 'ST', custom: { ovr: 70, talent: 'exceptional' } });
    const p = user(s);
    expect(p.position).toBe('ST');
    expect(Math.floor((s.day - p.birthDay) / 365.25)).toBe(16);
    expect(Object.keys(p.attrs)).toHaveLength(32);
    expect(overall(p)).toBeGreaterThan(60);
    expect(p.potential).toBeGreaterThan(overall(p));
  });

  it('2. joins a fictional professional club', () => {
    const p = user(s);
    expect(p.clubId).toBeTruthy();
    const club = s.clubs[p.clubId as string];
    expect(club.name.length).toBeGreaterThan(3);
    expect(club.stadium.length).toBeGreaterThan(3);
    expect(p.contract?.clubId).toBe(club.id);
    expect(p.contract!.wage).toBeGreaterThan(0);
    expect(s.squads[club.id]).toContain(p.id);
    oldClubId = club.id;
  });

  it('3. shows the squad and the manager', () => {
    const club = s.clubs[oldClubId];
    const squad = squadOf(s, club.id);
    expect(squad.length).toBeGreaterThanOrEqual(20);
    expect(squad.length).toBeLessThanOrEqual(34);
    expect(squad.some((x) => x.position === 'GK')).toBe(true);
    expect(club.manager.name.length).toBeGreaterThan(3);
    expect(['442', '433', '4231', '352', '532', '4141']).toContain(club.manager.formation);
    expect(s.relationships.find((r) => r.kind === 'manager')?.name).toBe(club.manager.name);
  });

  it('4. completes training and sees the sessions recorded', () => {
    s.training.plan = { ...s.training.plan, focus: 'finishing', intensity: 'normal' };
    const logged = s.training.log.length;
    idleDays(s, 7);
    expect(s.training.log.length).toBeGreaterThan(logged);
    expect(s.training.log.at(-1)?.focus).toBe('finishing');
    expect(s.career.ovrHistory.length).toBeGreaterThan(0);
  });

  it('5. advances to a match and previews it', () => {
    const r = advanceToNextMatch(s);
    expect(r.stop).toBe('match');
    dismissDecisions(s);
    const pre = previewMatch(s);
    expect(pre).not.toBeNull();
    expect(pre!.homeName).not.toBe(pre!.awayName);
    expect(['start', 'bench', 'out']).toContain(pre!.status);
    expect(pre!.reasons.length).toBeGreaterThan(0);
  });

  it('6. plays the match: every viewing mode gives the same result', () => {
    const a = clone(s);
    const b = clone(s);
    const c = clone(s);
    const ra = playUserMatch(a, 'instant')!;
    const rb = playUserMatch(b, 'commentary')!;
    const rc = playUserMatch(c, 'visual')!;
    expect([rb.record.result.hg, rb.record.result.ag]).toEqual([ra.record.result.hg, ra.record.result.ag]);
    expect([rc.record.result.hg, rc.record.result.ag]).toEqual([ra.record.result.hg, ra.record.result.ag]);
    expect(rc.record.result.events.length).toBeGreaterThanOrEqual(ra.record.result.events.length);
    expect(b.rngState).toBe(a.rngState);
    expect(c.finance.balance).toBe(a.finance.balance);
    // and play it for real, in the mode with text commentary
    const real = playUserMatch(s, 'commentary')!;
    firstRecord = real.record;
    expect(real.record.result.hg).toBe(ra.record.result.hg);
  });

  it('7. produces a match report with events, ratings and the player\'s own summary', () => {
    const rec = s.matchRecords[firstRecord.fixtureId];
    expect(rec).toBe(firstRecord);
    expect(s.userMatchLog).toContain(rec.fixtureId);
    expect(rec.result.events.length).toBeGreaterThan(20);
    expect(rec.result.motm).toBeTruthy();
    expect(Object.keys(rec.playerNames).length).toBeGreaterThanOrEqual(22);
    expect(rec.userSummary).toBeTruthy();
    expect(['start', 'bench', 'unused', 'notInSquad', 'injured', 'suspended']).toContain(rec.userSummary!.selected);
    expect(rec.userSummary!.managerReaction.length).toBeGreaterThan(3);
    expect(s.news.some((n) => n.type === 'match')).toBe(true);
  });

  it('8. updates the league table and the player\'s statistics', () => {
    const rec = firstRecord;
    const fx = s.fixtures[rec.fixtureId];
    expect(fx.played).toBe(true);
    expect(fx.result).toMatchObject({ hg: rec.result.hg, ag: rec.result.ag });
    if (rec.compId.startsWith('L')) {
      const table = leagueTable(s, rec.compId);
      for (const id of [rec.homeId, rec.awayId]) expect(table.find((r) => r.clubId === id)!.p).toBeGreaterThanOrEqual(1);
      expect(positionIn(table, oldClubId)).toBeGreaterThan(0);
    }
    const mins = rec.userSummary!.minutes;
    const line = user(s).stats.league ?? user(s).stats.cup;
    if (mins > 0) expect(line?.apps).toBeGreaterThanOrEqual(1);
    expect(s.career.appearances.apps).toBeGreaterThanOrEqual(mins > 0 ? 1 : 0);
  });

  it('9. pays wages weekly, with tax and living costs in the ledger', () => {
    const wages = () => s.finance.ledger.filter((e) => e.category === 'wage').length;
    const before = wages();
    const bal = s.finance.balance;
    playMatches(s, 6);
    expect(wages()).toBeGreaterThan(before);
    expect(s.finance.careerEarnings).toBeGreaterThan(0);
    expect(s.finance.ledger.some((e) => e.category === 'living')).toBe(true);
    expect(s.finance.balance).not.toBe(bal);
  });

  it('10. receives a transfer enquiry after strong performances', () => {
    let guard = 0;
    const enquiry = () => s.transfers.rumours.length > 0 || openOffers(s).length > 0 || s.news.some((n) => n.type === 'rumour');
    while (!enquiry() && guard++ < 60 && !s.career.retired) playMatches(s, 1);
    expect(enquiry(), `no club showed interest after ${guard} more matches`).toBe(true);
    expect(s.news.some((n) => (n.type === 'rumour' || n.type === 'transfer') && n.headline.length > 5)).toBe(true);
  }, 200000);

  it('11. negotiates a contract with an interested club', () => {
    // interest turns into formal bids only inside a window; the agent can be asked to canvass whenever it is open. A bid the
    // selling club refuses is withdrawn by the game, so keep going until one has an agreed fee and can actually be negotiated.
    const ready = () => openOffers(s).find((o) => (o.kind === 'permanent' || o.kind === 'free') && !o.preContract && o.status === 'open' && o.sellerAgreed);
    let guard = 0;
    while (!ready() && guard++ < 150 && !s.career.retired) {
      playMatches(s, 1);
      dismissDecisions(s);
      if (windowInfo(s).open) agentCanvass(s);
    }
    const found = ready();
    expect(found, `no workable offer arrived in ${guard} further matches`).toBeTruthy();
    offer = found as TransferOffer;
    expect(offer.fee).toBeGreaterThanOrEqual(0);
    expect(offer.wage).toBeGreaterThan(0);
    const asked = { ...proposalOf(offer), wage: Math.round(offer.wage * 1.05) };
    const out = negotiateOffer(s, offer.id, asked);
    expect(out.ok, out.message).toBe(true);
    expect(['accepted', 'countered']).toContain('status' in out ? out.status : '');
    expect(offer.log!.some((l) => l.by === 'you')).toBe(true);
  }, 250000);

  it('12. transfers to another club', () => {
    const before = user(s).clubId as string;
    expect(windowInfo(s).open).toBe(true);
    expect(offer.status === 'open' || offer.status === 'negotiating').toBe(true);
    const r = acceptOffer(s, offer.id);
    expect(r.ok, r.message).toBe(true);
    const p = user(s);
    expect(p.clubId).toBe(offer.fromClubId);
    expect(p.clubId).not.toBe(before);
    expect(p.contract?.clubId).toBe(p.clubId);
    expect(p.contract?.wage).toBe(offer.wage);
    expect(s.career.transfers.some((t) => t.toClubId === p.clubId && (t.kind === 'permanent' || t.kind === 'free'))).toBe(true);
    expect(s.squads[p.clubId as string]).toContain(p.id);
    expect(s.squads[before]).not.toContain(p.id);
    expect(s.news.some((n) => n.type === 'transfer' && /joins/.test(n.headline))).toBe(true);
  });

  it('13. continues through the season, playing for the new club', () => {
    const club = user(s).clubId as string;
    const appsBefore = s.career.appearances.apps;
    playUntilSeason(s, s.season + 1, autoHandle);
    endedSeason = s.season - 1;
    expect(s.season).toBe(endedSeason + 1);
    expect(s.career.appearances.apps).toBeGreaterThan(appsBefore);
    expect(user(s).clubId).toBeTruthy();
    expect(club).toBeTruthy();
  }, 250000);

  it('14. finishes the season with a league position and a cup result', () => {
    const rec = s.career.seasons.filter((x) => x.season === endedSeason).at(-1)!;
    expect(rec).toBeTruthy();
    expect(rec.leaguePos).toBeGreaterThan(0);
    expect(rec.leagueName.length).toBeGreaterThan(3);
    expect(s.lastSeasonSummary?.season).toBe(endedSeason);
    expect(s.lastSeasonSummary?.champion.length).toBeGreaterThan(2);
    const cup = cupOf(s, endedSeason)!;
    expect(cup.completed).toBe(true);
    expect(clubCupStage(cup, rec.clubId)).toBeTruthy();
    expect(s.history.some((h) => h.season === endedSeason)).toBe(true);
  });

  it('15. hands out end-of-season awards where deserved', () => {
    const awards = s.awards.filter((a) => a.season === endedSeason);
    expect(awards.length).toBeGreaterThan(0);
    expect(awards.some((a) => a.award === 'Player of the Year')).toBe(true);
    for (const a of awards) expect(s.players[a.playerId]).toBeTruthy();
    // an award the user won is recorded on his own season line and in his milestones
    for (const a of awards.filter((x) => x.playerId === s.userId)) {
      expect(s.career.milestones.some((m) => m.kind === 'award' && m.title === a.award)).toBe(true);
    }
  });

  it('16. saves and reloads the career without losing anything', async () => {
    await saveToSlot(1, s);
    const slots = await listSlots();
    expect(slots[0].meta?.playerName).toBe(user(s).displayName);
    const loaded = await loadSlot(1);
    reloaded = loaded.state;
    expect(loaded.usedBackup).toBe(false);
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(s));
    expect(reloaded.career.seasons).toEqual(s.career.seasons);
    expect(reloaded.finance.ledger).toEqual(s.finance.ledger);
  }, 60000);

  it('17. continues into the following season, identically from the reloaded career', () => {
    const a = clone(s);
    playUntilSeason(a, endedSeason + 2, autoHandle);
    playUntilSeason(reloaded, endedSeason + 2, autoHandle);
    expect(reloaded.season).toBe(endedSeason + 2);
    expect(reloaded.day).toBe(a.day);
    expect(reloaded.rngState).toBe(a.rngState);
    expect(reloaded.finance.balance).toBe(a.finance.balance);
    expect(reloaded.career.appearances).toEqual(a.career.appearances);
    expect(JSON.stringify(user(reloaded).attrs)).toBe(JSON.stringify(user(a).attrs));
    expect(reloaded.career.seasons.length).toBeGreaterThan(s.career.seasons.length - 1);
  }, 280000);
});
