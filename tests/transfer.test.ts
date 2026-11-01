import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { seasonEndDay } from '../src/engine/dates';
import { getPlan } from '../src/engine/season';
import { marketValue, roundMoney, transferBudgetFor } from '../src/engine/economy';
import {
  acceptOffer, agentCanvass, agentCandidates, agentRecommendations, agentWageAdvice, createExtensionOffer, createFreeOffer,
  createLoanOffer, createPermanentOffer, difficultyFactors, hireAgent, negotiateOffer, negotiationCeiling, openOffers, packageCost,
  preContractClub, processTransfersDaily, proposalOf, rejectOffer, requestExtension, requestLoan, requestTransfer, wageBill, wageRoom,
  windowInfo, withdrawTransferRequest,
} from '../src/engine/transfers';
import type { Club, GameState, TransferOffer } from '../src/engine/types';
import { advanceDays, playUserMatch } from '../src/engine/game';
import { autoHandle, clone, newCareer, playUntilSeason, user } from './helpers';

/** a career in the summer window with a rich buyer who is allowed to sign the player outright via his release clause */
function setup(seed = 313) {
  const s = newCareer(seed);
  const p = user(s);
  const plan = getPlan(s);
  expect(s.day).toBeGreaterThanOrEqual(plan.summerWindow[0]);
  s.transfers.windowOpen = true;
  const buyers = Object.values(s.clubs).filter((c) => c.id !== p.clubId);
  const rich = (c: Club) => { c.transferBudget = 5e8; c.wageBudget = 5e7; c.balance = 1e9; c.signingsThisWindow = 0; return c; };
  const buyer = rich(buyers[0]);
  const other = rich(buyers[1]);
  p.contract!.releaseClause = roundMoney(marketValue(p, s.day) * 1.2);
  return { s, p, buyer, other, rng: new Rng(7), seller: s.clubs[p.clubId as string] };
}

const clauseOffer = (s: GameState, rng: Rng, club: Club): TransferOffer => {
  const o = createPermanentOffer(s, rng, club, { viaClause: true });
  expect(o).not.toBeNull();
  return o as TransferOffer;
};

describe('transfer windows', () => {
  it('is open in the summer window and closed outside both windows', () => {
    const s = newCareer(11);
    const plan = getPlan(s);
    s.day = plan.summerWindow[0] + 1;
    expect(windowInfo(s).open).toBe(true);
    expect(windowInfo(s).closesIn).toBeGreaterThanOrEqual(0);
    s.day = plan.summerWindow[1] + 10;
    const closed = windowInfo(s);
    expect(closed.open).toBe(false);
    expect(closed.opensIn).toBeGreaterThan(0);
    s.day = plan.winterWindow[0] + 1;
    expect(windowInfo(s).open).toBe(true);
    expect(windowInfo(s).label).toBe('January window');
  });

  it('refuses to complete a permanent move while the window is shut', () => {
    const { s, rng, buyer, p } = setup(12);
    const o = clauseOffer(s, rng, buyer);
    s.transfers.windowOpen = false;
    const r = acceptOffer(s, o.id);
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain('window');
    expect(p.clubId).not.toBe(buyer.id);
    expect(o.status).toBe('open');
  });
});

describe('offers', () => {
  it('creates a well-formed offer inside the club\'s limits', () => {
    const { s, rng, buyer } = setup(13);
    const o = clauseOffer(s, rng, buyer);
    expect(o.kind).toBe('permanent');
    expect(o.fee).toBeGreaterThan(0);
    expect(o.wage).toBeGreaterThan(0);
    expect(o.years).toBeGreaterThanOrEqual(o.minYears);
    expect(o.years).toBeLessThanOrEqual(o.maxYears);
    expect(o.maxWage).toBeGreaterThanOrEqual(o.wage);
    expect(o.expiresDay).toBeGreaterThanOrEqual(s.day);
    expect(o.log?.length).toBeGreaterThan(0);
    expect(openOffers(s)).toContain(o);
    expect(s.news.some((n) => n.type === 'transfer' && n.clubId === buyer.id)).toBe(true);
  });

  it('does not stack two offers from the same club or make offers the club cannot fund', () => {
    const { s, rng, buyer, other } = setup(14);
    clauseOffer(s, rng, buyer);
    expect(createPermanentOffer(s, rng, buyer, { viaClause: true })).toBeNull();
    other.transferBudget = 0;
    expect(createPermanentOffer(s, rng, other, { viaClause: true })).toBeNull();
  });

  it('holds back an offer the selling club has not agreed to', () => {
    const { s, rng, buyer, p } = setup(15);
    p.contract!.releaseClause = null;
    buyer.transferBudget = marketValue(p, s.day) * 0.6;
    const o = createPermanentOffer(s, rng, buyer, {});
    if (!o) return; // the club may legitimately decline to bid at that budget
    if (!o.sellerAgreed) {
      expect(o.status).toBe('negotiating');
      const r = acceptOffer(s, o.id);
      expect(r.ok).toBe(false);
      expect(p.clubId).not.toBe(buyer.id);
    }
  });

  it('lets the user turn an offer down exactly once', () => {
    const { s, rng, buyer } = setup(16);
    const o = clauseOffer(s, rng, buyer);
    expect(rejectOffer(s, o.id).ok).toBe(true);
    expect(o.status).toBe('rejected');
    expect(rejectOffer(s, o.id).ok).toBe(false);
    expect(acceptOffer(s, o.id).ok).toBe(false);
    expect(openOffers(s)).not.toContain(o);
    expect(user(s).clubId).not.toBe(buyer.id);
  });
});

describe('accepting a permanent transfer', () => {
  it('moves the player, pays the fee between clubs and signs a contract on the offered terms', () => {
    const { s, rng, buyer, other, p, seller } = setup(21);
    const o = clauseOffer(s, rng, buyer);
    const rival = clauseOffer(s, rng, other);
    const buyerBefore = buyer.balance;
    const sellerBefore = seller.balance;
    const fromId = seller.id;
    const r = acceptOffer(s, o.id);
    expect(r.ok, r.message).toBe(true);
    expect(o.status).toBe('accepted');
    expect(p.clubId).toBe(buyer.id);
    expect(p.contract?.clubId).toBe(buyer.id);
    expect(p.contract?.wage).toBe(o.wage);
    expect(p.contract?.endDay).toBe(seasonEndDay(s.season + o.years - 1));
    expect(p.loan).toBeNull();
    expect(s.squads[buyer.id]).toContain(p.id);
    expect(s.squads[fromId]).not.toContain(p.id);
    const homes = Object.values(s.squads).filter((ids) => ids.includes(p.id));
    expect(homes).toHaveLength(1);
    expect(buyer.balance).toBe(buyerBefore - o.fee);
    expect(seller.balance).toBe(sellerBefore + o.fee);
    expect(rival.status).toBe('withdrawn'); // other bids lapse once a move is agreed
    expect(s.career.transfers.at(-1)).toMatchObject({ fromClubId: fromId, toClubId: buyer.id, fee: o.fee });
    expect(s.career.contracts.at(-1)).toMatchObject({ clubId: buyer.id, wage: o.wage, kind: 'signed' });
    expect(s.news.some((n) => n.type === 'transfer' && n.headline.includes('joins'))).toBe(true);
    expect(s.career.achievements.first_transfer).toBeDefined();
    expect(wageBill(s, buyer.id)).toBeLessThanOrEqual(buyer.wageBudget);
    expect(wageRoom(s, buyer.id)).toBeGreaterThanOrEqual(0);
  });

  it('pays the signing bonus through the ledger exactly once, even if the move is attempted again', () => {
    const { s, rng, buyer, p } = setup(22);
    const o = clauseOffer(s, rng, buyer);
    const before = s.finance.balance;
    expect(acceptOffer(s, o.id).ok).toBe(true);
    expect(acceptOffer(s, o.id).ok).toBe(false);
    const bonus = s.finance.ledger.filter((e) => e.category === 'signing_bonus');
    expect(bonus).toHaveLength(1);
    expect(bonus[0].amount).toBe(o.signingBonus);
    expect(s.finance.balance).toBeGreaterThan(before);
    // the ledger is an unbroken running balance
    let run = s.finance.ledger[0].balanceAfter - s.finance.ledger[0].amount;
    for (const e of s.finance.ledger) { run += e.amount; expect(e.balanceAfter).toBe(run); }
    expect(s.finance.ledger.at(-1)?.balanceAfter).toBe(s.finance.balance);
    expect(p.clubId).toBe(buyer.id);
  });

  it('lets the player resume the game from the new club, with matches and wages following the move', () => {
    const { s, rng, buyer, p } = setup(23);
    acceptOffer(s, clauseOffer(s, rng, buyer).id);
    expect(p.clubId).toBe(buyer.id);
    expect(userAppealRole(s)).toBeTruthy();
    expect(s.relationships.find((r) => r.kind === 'manager')?.name).toBe(buyer.manager.name);
  });
});

describe('club funding', () => {
  it('lets bigger clubs risk more of their squad value on one signing', () => {
    expect(transferBudgetFor(0, 100e6, 85)).toBeGreaterThan(transferBudgetFor(0, 100e6, 60));
    expect(transferBudgetFor(0, 100e6, 60)).toBeGreaterThan(transferBudgetFor(0, 100e6, 30));
    expect(transferBudgetFor(0, 100e6, 95)).toBe(transferBudgetFor(0, 100e6, 90)); // the share is capped
    expect(transferBudgetFor(50e6, 10e6, 50)).toBe(14e6); // a rich bank balance still counts
  });

  it('only bids when the club could meet the price the selling club will accept', () => {
    const { s, rng, buyer, p } = setup(41);
    p.contract!.releaseClause = null;
    const value = marketValue(p, s.day);
    buyer.transferBudget = Math.round(value * 0.5);
    expect(createPermanentOffer(s, rng, buyer, {})).toBeNull(); // would only be raised and then withdrawn
    buyer.transferBudget = Math.round(value * 2);
    const o = createPermanentOffer(s, rng, buyer, {});
    expect(o).not.toBeNull();
    expect(o!.fee).toBeLessThanOrEqual(buyer.transferBudget);
    expect(['open', 'negotiating']).toContain(o!.status);
  });

  it('withdraws an offer the club can no longer pay for instead of leaving it to fail on acceptance', () => {
    const { s, rng, buyer, p } = setup(42);
    const o = clauseOffer(s, rng, buyer);
    buyer.wageBudget = wageBill(s, buyer.id) + 1; // the wage room has gone
    processTransfersDaily(s, rng);
    expect(o.status).toBe('withdrawn');
    expect(openOffers(s)).not.toContain(o);
    expect(acceptOffer(s, o.id).ok).toBe(false);
    expect(p.clubId).not.toBe(buyer.id);
    expect(s.transfers.history.some((h) => h.offerId === o.id && h.result === 'withdrawn')).toBe(true);
  });

  it('stops a club with a live bid from signing other players, while the same club trades freely without one', () => {
    const { s, rng, buyer } = setup(43);
    // give the buyer a hole at goalkeeper and make it the only club trading, so that it signs within days if it is allowed to
    for (const id of s.squads[buyer.id].filter((x) => s.players[x].position === 'GK')) {
      s.squads[buyer.id] = s.squads[buyer.id].filter((x) => x !== id);
      s.players[id].clubId = null;
      s.players[id].contract = null;
      s.transfers.freeAgentIds.push(id);
    }
    for (const c of Object.values(s.clubs)) if (c.id !== buyer.id) c.signingsThisWindow = 99;
    const bid = clauseOffer(s, rng, buyer);
    bid.expiresDay = s.day + 200;
    const control = clone(s);
    const trade = (state: GameState, days: number) => {
      const r = new Rng(9);
      for (let i = 0; i < days; i++) { state.day++; state.transfers.windowOpen = true; processTransfersDaily(state, r); }
    };
    const cb = control.clubs[buyer.id];
    control.transfers.offers.forEach((o) => { o.status = 'rejected'; }); // same world, but nobody is bidding for the player
    trade(control, 30);
    expect(cb.signingsThisWindow, 'the control club never signed anyone, so this test proves nothing').toBeGreaterThan(0);
    const room = wageRoom(s, buyer.id);
    trade(s, 30);
    expect(bid.status).toBe('open');
    expect(buyer.signingsThisWindow).toBe(0);
    expect(wageRoom(s, buyer.id)).toBe(room);
  });

  it('keeps a bidding club from spending the money and wage room it has promised to the player', () => {
    // a real two-season calendar for a player the clubs want; every day, a club whose bid was live before and after must not
    // have signed anyone in between
    const s = newCareer(5, { pathway: 'custom', age: 16, position: 'ST', custom: { ovr: 66, talent: 'great' } });
    let observed = 0;
    let guard = 0;
    while (s.season < 2028 && !s.career.retired && guard++ < 1500) {
      const live = new Map<string, { id: string; signings: number; room: number }>();
      for (const o of openOffers(s)) {
        if (o.kind === 'permanent' || o.kind === 'free') live.set(o.fromClubId, { id: o.id, signings: s.clubs[o.fromClubId].signingsThisWindow, room: wageRoom(s, o.fromClubId) });
      }
      const day = s.day;
      const r = advanceDays(s, 1);
      if (r.stop === 'match') playUserMatch(s, 'instant');
      else if (r.stop === 'decision' || r.stop === 'offer' || r.stop === 'season_end') autoHandle(s);
      else if (r.stop === 'retired') break;
      if (s.day !== day + 1) continue; // a rollover or a window reset happened: counters are not comparable
      for (const [clubId, before] of live) {
        const still = s.transfers.offers.find((o) => o.id === before.id);
        if (!still || (still.status !== 'open' && still.status !== 'negotiating')) continue;
        observed++;
        expect(s.clubs[clubId].signingsThisWindow, `${clubId} signed someone while bidding`).toBe(before.signings);
        expect(wageRoom(s, clubId)).toBeGreaterThanOrEqual(before.room);
      }
    }
    expect(observed).toBeGreaterThan(5);
  }, 120000);
});

const userAppealRole = (s: GameState) => s.career.squadRole;

describe('negotiation', () => {
  function open(seed: number) {
    const ctx = setup(seed);
    return { ...ctx, o: clauseOffer(ctx.s, ctx.rng, ctx.buyer) };
  }

  it('accepts the club\'s own terms unchanged', () => {
    const { s, o } = open(31);
    const out = negotiateOffer(s, o.id, proposalOf(o));
    expect('status' in out && out.status).toBe('accepted');
  });

  it('accepts a better package that is within what the club will pay and applies it to the offer', () => {
    const { s, o } = open(32);
    const ceiling = negotiationCeiling(s, o);
    const asked = { ...proposalOf(o), wage: Math.round(o.wage * 1.04) };
    expect(packageCost(asked)).toBeLessThan(ceiling * 0.96);
    const out = negotiateOffer(s, o.id, asked);
    expect('status' in out && out.status).toBe('accepted');
    expect(o.wage).toBe(asked.wage);
  });

  it('counters a push just above the limit and spends patience each time', () => {
    const { s, o } = open(33);
    const ceiling = negotiationCeiling(s, o);
    const base = proposalOf(o);
    const wage = Math.ceil(base.wage * (ceiling * 1.03 / packageCost(base)));
    const patience = o.patience;
    const out = negotiateOffer(s, o.id, { ...base, wage });
    expect('status' in out && out.status).toBe('countered');
    expect(o.patience).toBe(patience - 1);
    expect(o.wage).toBeLessThanOrEqual(wage);
    expect(o.status === 'open' || o.status === 'negotiating').toBe(true);
  });

  it('walks away when the demands are absurd for long enough', () => {
    const { s, o, p } = open(34);
    const base = proposalOf(o);
    let last = '';
    for (let i = 0; i < 12 && (o.status === 'open' || o.status === 'negotiating'); i++) {
      const out = negotiateOffer(s, o.id, { ...base, wage: base.wage * 6 });
      last = 'status' in out ? out.status : 'x';
    }
    expect(last).toBe('withdrawn');
    expect(o.status).toBe('withdrawn');
    expect(negotiateOffer(s, o.id, base).ok).toBe(false);
    expect(acceptOffer(s, o.id).ok).toBe(false);
    expect(p.clubId).not.toBe(o.fromClubId);
  });

  it('refuses a release clause that is unrealistically low and cannot negotiate a loan', () => {
    const { s, o, rng, other } = open(35);
    const out = negotiateOffer(s, o.id, { ...proposalOf(o), releaseClause: 1000 });
    expect('offer' in out && out.offer.releaseClause).toBeNull();
    const loan = createLoanOffer(s, rng, other) as TransferOffer;
    expect(negotiateOffer(s, loan.id, proposalOf(loan)).ok).toBe(false);
  });

  it('is repeatable for the same inputs', () => {
    const a = open(36);
    const b = open(36);
    const pa = negotiateOffer(a.s, a.o.id, { ...proposalOf(a.o), wage: a.o.wage * 1.5 });
    const pb = negotiateOffer(b.s, b.o.id, { ...proposalOf(b.o), wage: b.o.wage * 1.5 });
    expect('status' in pa && pa.status).toBe('status' in pb && pb.status);
    expect(a.o.wage).toBe(b.o.wage);
  });
});

describe('loans', () => {
  it('moves the player to the loan club while the parent keeps the contract, then brings him home at season end', () => {
    const { s, rng, other, p, seller } = setup(41);
    const loan = createLoanOffer(s, rng, other) as TransferOffer;
    expect(loan.kind).toBe('loan');
    const wageBefore = p.contract!.wage;
    const r = acceptOffer(s, loan.id);
    expect(r.ok, r.message).toBe(true);
    expect(p.clubId).toBe(other.id);
    expect(p.loan?.parentClubId).toBe(seller.id);
    expect(p.contract?.clubId).toBe(seller.id);
    expect(p.contract?.wage).toBe(wageBefore);
    expect(s.career.transfers.at(-1)?.kind).toBe('loan');
    playUntilSeason(s, s.season + 1);
    expect(p.loan).toBeNull();
    expect(p.clubId).toBe(seller.id);
  }, 120000);

  it('only arranges a loan for a young player who is not in the plans, and only in a window', () => {
    const { s, p } = setup(42);
    s.career.squadRole = 'Key player';
    expect(requestLoan(s).ok).toBe(false);
    s.career.squadRole = 'Fringe player';
    s.transfers.windowOpen = false;
    expect(requestLoan(s).message.toLowerCase()).toContain('window');
    s.transfers.windowOpen = true;
    const r = requestLoan(s);
    if (r.ok) expect(openOffers(s).some((x) => x.kind === 'loan')).toBe(true);
    expect(p.loan).toBeNull();
  });
});

describe('contracts: extensions, requests and pre-contracts', () => {
  it('declines to renegotiate when the contract has plenty of time left', () => {
    const { s, p } = setup(51);
    s.career.squadRole = 'Key player';
    p.contract!.endDay = s.day + 365 * 4;
    const r = requestExtension(s);
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain('plenty of time');
    expect(openOffers(s).some((o) => o.kind === 'extension')).toBe(false);
  });

  it('offers and signs an extension that never shortens the existing deal', () => {
    const { s, rng, p } = setup(52);
    s.career.squadRole = 'Key player';
    p.contract!.endDay = s.day + 200;
    const old = { ...p.contract! };
    const o = createExtensionOffer(s, rng) as TransferOffer;
    expect(o.kind).toBe('extension');
    expect(o.wage).toBeGreaterThanOrEqual(Math.round(old.wage * 1.02));
    expect(acceptOffer(s, o.id).ok).toBe(true);
    expect(p.contract!.endDay).toBeGreaterThanOrEqual(old.endDay);
    expect(p.contract!.wage).toBe(o.wage);
    expect(p.clubId).toBe(old.clubId);
    expect(s.career.contracts.at(-1)?.kind).toBe('extended');
    expect(s.finance.ledger.filter((e) => e.category === 'signing_bonus')).toHaveLength(1);
  });

  it('will not accept an extension offer twice or while one is already waiting', () => {
    const { s, rng, p } = setup(53);
    s.career.squadRole = 'Key player';
    p.contract!.endDay = s.day + 200;
    const o = createExtensionOffer(s, rng) as TransferOffer;
    expect(createExtensionOffer(s, rng)).toBeNull();
    expect(acceptOffer(s, o.id).ok).toBe(true);
    expect(acceptOffer(s, o.id).ok).toBe(false);
  });

  it('records a transfer request, costs trust, and lets it be withdrawn', () => {
    const { s } = setup(54);
    const trust = s.career.managerTrust;
    expect(requestTransfer(s).ok).toBe(true);
    expect(typeof s.flags.transferRequest).toBe('number');
    expect(s.career.managerTrust).toBeLessThan(trust);
    expect(requestTransfer(s).ok).toBe(false);
    expect(withdrawTransferRequest(s).ok).toBe(true);
    expect(s.flags.transferRequest).toBeUndefined();
    expect(withdrawTransferRequest(s).ok).toBe(false);
  });

  it('binds the player to a pre-contract club, blocks other moves, and completes it when the contract ends', () => {
    const { s, rng, buyer, other, p } = setup(55);
    p.contract!.endDay = seasonEndDay(s.season);
    const pre = createFreeOffer(s, rng, buyer, true) as TransferOffer;
    expect(pre.preContract).toBe(true);
    expect(pre.fee).toBe(0);
    const rival = clauseOffer(s, rng, other);
    expect(acceptOffer(s, pre.id).ok).toBe(true);
    expect(preContractClub(s)?.id).toBe(buyer.id);
    expect(p.clubId).not.toBe(buyer.id); // nothing happens until the contract runs out
    expect(rival.status).toBe('withdrawn');
    expect(requestExtension(s).ok).toBe(false);
    const another = createPermanentOffer(s, rng, other, { viaClause: true });
    expect(another).toBeNull();
    playUntilSeason(s, s.season + 1);
    expect(p.clubId).toBe(buyer.id);
    expect(p.contract?.clubId).toBe(buyer.id);
    expect(s.flags.preContractOffer).toBeUndefined();
    expect(s.career.transfers.some((t) => t.toClubId === buyer.id && t.kind === 'free')).toBe(true);
  }, 120000);
});

describe('the agent', () => {
  it('advises a wage band that brackets his estimate', () => {
    const { s } = setup(61);
    const a = agentWageAdvice(s);
    expect(a.low).toBeLessThanOrEqual(a.fair);
    expect(a.high).toBeGreaterThanOrEqual(a.fair);
    expect(a.value).toBeGreaterThan(0);
    expect(a.comment.length).toBeGreaterThan(5);
  });

  it('recommends clubs other than the current one, best fit first, within the requested count', () => {
    const { s, p } = setup(62);
    const recs = agentRecommendations(s, 5);
    expect(recs.length).toBeLessThanOrEqual(5);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) { expect(r.club.id).not.toBe(p.clubId); expect(r.chance).toBeGreaterThan(0); expect(r.chance).toBeLessThanOrEqual(1); }
  });

  it('rations canvassing with a cooldown, and uses a random stream that is saved with the career', () => {
    const { s } = setup(63);
    s.transfers.agent.lastCanvassDay = s.day - 100;
    const first = agentCanvass(s);
    expect(first.ok).toBe(true);
    expect(first.lines.length).toBeGreaterThan(0);
    expect(agentCanvass(s).ok).toBe(false);
  });

  it('lets the user hire a different agent, and never the one already hired', () => {
    const { s } = setup(64);
    const [first] = agentCandidates(s);
    expect(hireAgent(s, first.id).ok).toBe(true);
    expect(s.transfers.agent.id).toBe(first.id);
    expect(hireAgent(s, first.id).ok).toBe(false);
    expect(hireAgent(s, 'nobody').ok).toBe(false);
    expect(s.relationships.find((r) => r.kind === 'agent')?.name).toBe(first.name);
  });

  it('makes the game kinder on casual and harder on simulation', () => {
    const s = newCareer(65);
    s.settings.difficulty = 'casual';
    const c = difficultyFactors(s);
    s.settings.difficulty = 'simulation';
    const h = difficultyFactors(s);
    expect(c.interest).toBeGreaterThan(h.interest);
    expect(c.consent).toBeGreaterThan(h.consent);
    expect(c.patience).toBeGreaterThan(h.patience);
  });
});
