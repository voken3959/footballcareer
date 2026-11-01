/**
 * Life away from the pitch: the shop (housing, cars, clothing, travel, services, entertainment), investments, sponsorships,
 * relationships, public reputation and the personal decisions that come up along the way.
 *
 * Everything is deterministic. Event selection uses the career random stream; the outcome of a decision or an investment
 * review uses a stream derived from the career seed and the decision / investment id, so reloading a save and making the same
 * choice always gives the same result. All money moves through finance.post so it shows in the ledger.
 */
import type {
  DecisionOption, GameState, Investment, PendingDecision, Player, Purchase, Relationship, Reputation, Sponsorship,
} from './types';
import { Rng, clamp, seedFrom } from './rng';
import { ageAt, overall } from './attributes';
import { dayOfWeek } from './dates';
import { addNews, uid, userPlayer } from './util';
import { money, roundMoney, roundWage } from './economy';
import { claim, post, weeklyTax } from './finance';
import { unlock } from './awards';
import { nextUserFixture } from './daily';
import { genName } from './playerGen';
import type { ActionResult } from './transfers';

/* ================================================================== catalogue */

export type CatalogCategory = 'housing' | 'cars' | 'clothing' | 'travel' | 'services' | 'entertainment';
export type CatalogMode = 'housing' | 'owned' | 'service' | 'experience';

export interface CatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  mode: CatalogMode;
  blurb: string;
  price: number;
  /** weekly cost while you keep it */
  upkeep: number;
  minAge?: number;
  /** what it does, shown on the card exactly as the game applies it */
  effects: string[];
  /** immediate change (experiences and the moment of purchase for owned items) */
  morale?: number;
  fatigue?: number;
  confidence?: number;
  rep?: Partial<Reputation>;
  rel?: { family?: number; friend?: number; partner?: number };
  /** permanent mood lift while you own it (shifts your resting morale) */
  mood?: number;
  /** housing only: how well you rest and recover */
  comfort?: number;
  cooldownDays?: number;
  /** experiences that take you away: the next match must be at least this many days off */
  freeDays?: number;
  resale?: 'car' | 'home';
}

export const CATALOG: CatalogItem[] = [
  // ---- housing
  { id: 'home_family', name: 'Live with your family', category: 'housing', mode: 'housing', blurb: 'Home cooking, familiar faces and no rent.', price: 0, upkeep: 0, comfort: 1,
    effects: ['No rent', 'Your relationship with your family grows slowly'] },
  { id: 'flat_share', name: 'Shared flat near the training ground', category: 'housing', mode: 'housing', blurb: 'Your first place away from home, split with another young player.', price: 180, upkeep: 85, comfort: 2, minAge: 18,
    effects: ['Rent £85 a week', 'Slightly better rest than home'] },
  { id: 'flat_rent', name: 'Rented one-bedroom flat', category: 'housing', mode: 'housing', blurb: 'Quiet, close to the club, entirely yours.', price: 650, upkeep: 240, comfort: 3, minAge: 18,
    effects: ['Rent £240 a week', 'Good rest and a small lift to your mood'] },
  { id: 'house_rent', name: 'Rented detached house', category: 'housing', mode: 'housing', blurb: 'Space for friends and family to stay.', price: 2400, upkeep: 650, comfort: 4, minAge: 18,
    effects: ['Rent £650 a week', 'Very good rest, friends and family visit more'] },
  { id: 'house_own', name: 'Your own house', category: 'housing', mode: 'housing', blurb: 'A home of your own that should hold its value.', price: 285000, upkeep: 140, comfort: 4, minAge: 18, resale: 'home',
    effects: ['Running costs £140 a week', 'Very good rest', 'Can be sold later, usually for a little more than you paid'] },
  { id: 'villa', name: 'Luxury villa with gym and pool', category: 'housing', mode: 'housing', blurb: 'The kind of place that gets written about.', price: 2400000, upkeep: 520, comfort: 6, minAge: 21, resale: 'home', rep: { media: 1.5 },
    effects: ['Running costs £520 a week', 'Best possible rest and a home gym', 'Raises your media profile'] },
  // ---- cars
  { id: 'car_used', name: 'Reliable used hatchback', category: 'cars', mode: 'owned', blurb: 'Gets you to training on time.', price: 3800, upkeep: 22, minAge: 17, resale: 'car', morale: 1.5, mood: 0.5,
    effects: ['Running costs £22 a week', 'Small mood lift'] },
  { id: 'car_family', name: 'Family saloon', category: 'cars', mode: 'owned', blurb: 'Comfortable and sensible.', price: 18500, upkeep: 40, minAge: 17, resale: 'car', morale: 2, mood: 0.8,
    effects: ['Running costs £40 a week', 'Small mood lift'] },
  { id: 'car_sports', name: 'Sports car', category: 'cars', mode: 'owned', blurb: 'Fast, loud and noticed.', price: 85000, upkeep: 105, minAge: 18, resale: 'car', morale: 3, mood: 1, rep: { media: 0.6 },
    effects: ['Running costs £105 a week', 'Mood lift', 'Slight rise in media attention'] },
  { id: 'car_luxury', name: 'Luxury grand tourer', category: 'cars', mode: 'owned', blurb: 'The car every footballer is supposed to have.', price: 210000, upkeep: 170, minAge: 18, resale: 'car', morale: 4, mood: 1.2, rep: { media: 1.4 },
    effects: ['Running costs £170 a week', 'Mood lift', 'Raises your media profile'] },
  // ---- clothing
  { id: 'clo_casual', name: 'New casual wardrobe', category: 'clothing', mode: 'experience', blurb: 'Clothes that fit and look good.', price: 220, upkeep: 0, morale: 1.5, rep: { media: 0.2 }, cooldownDays: 90,
    effects: ['Morale +1.5', 'Repeatable every 90 days'] },
  { id: 'clo_designer', name: 'Designer wardrobe', category: 'clothing', mode: 'experience', blurb: 'Labels, tailoring and a stylist.', price: 2800, upkeep: 0, morale: 2.5, rep: { media: 0.8 }, cooldownDays: 120, minAge: 18,
    effects: ['Morale +2.5', 'Media reputation +0.8', 'Repeatable every 120 days'] },
  { id: 'clo_tailor', name: 'Tailored matchday and event suits', category: 'clothing', mode: 'experience', blurb: 'Look the part arriving and leaving.', price: 6500, upkeep: 0, morale: 2, rep: { media: 1.2, professional: 0.3 }, cooldownDays: 180, minAge: 18,
    effects: ['Morale +2', 'Media reputation +1.2, professional +0.3', 'Repeatable every 180 days'] },
  // ---- travel
  { id: 'trv_weekend', name: 'Weekend away', category: 'travel', mode: 'experience', blurb: 'Two nights somewhere quiet.', price: 420, upkeep: 0, fatigue: -22, morale: 5, confidence: 1, cooldownDays: 14, freeDays: 3,
    effects: ['Fatigue -22, morale +5', 'Needs three clear days before your next match', 'Repeatable every 14 days'] },
  { id: 'trv_family', name: 'Treat your family to a trip', category: 'travel', mode: 'experience', blurb: 'They gave up a lot for you.', price: 2200, upkeep: 0, fatigue: -20, morale: 6, rel: { family: 10 }, cooldownDays: 120, freeDays: 5, minAge: 17,
    effects: ['Fatigue -20, morale +6', 'Family relationship +10', 'Needs five clear days before your next match', 'Repeatable every 120 days'] },
  { id: 'trv_holiday', name: 'Two-week holiday', category: 'travel', mode: 'experience', blurb: 'Properly switch off.', price: 3600, upkeep: 0, fatigue: -40, morale: 9, confidence: 2, cooldownDays: 150, freeDays: 8,
    effects: ['Fatigue -40, morale +9', 'Needs eight clear days before your next match', 'Repeatable every 150 days'] },
  { id: 'trv_luxury', name: 'Luxury trip abroad', category: 'travel', mode: 'experience', blurb: 'Private villa, private beach.', price: 18500, upkeep: 0, fatigue: -45, morale: 12, confidence: 2, rep: { media: 0.5 }, cooldownDays: 180, freeDays: 8, minAge: 18,
    effects: ['Fatigue -45, morale +12', 'Media reputation +0.5', 'Needs eight clear days before your next match', 'Repeatable every 180 days'] },
  // ---- personal services
  { id: 'svc_trainer', name: 'Personal trainer', category: 'services', mode: 'service', blurb: 'Extra individual sessions built around your weaknesses.', price: 0, upkeep: 190,
    effects: ['£190 a week', 'About 5% faster attribute growth while you are developing'] },
  { id: 'svc_nutritionist', name: 'Nutritionist', category: 'services', mode: 'service', blurb: 'A diet plan that suits your body and schedule.', price: 0, upkeep: 120,
    effects: ['£120 a week', 'About 3% faster growth', 'Slightly faster recovery'] },
  { id: 'svc_chef', name: 'Private chef', category: 'services', mode: 'service', blurb: 'Meals prepared properly, every day.', price: 0, upkeep: 260, minAge: 18,
    effects: ['£260 a week', 'About 2% faster growth', 'Faster recovery, small mood lift'] },
  { id: 'svc_physio', name: 'Private physio', category: 'services', mode: 'service', blurb: 'On call for every niggle.', price: 0, upkeep: 210,
    effects: ['£210 a week', 'Injuries heal about one day in five faster'] },
  { id: 'svc_mindset', name: 'Sports psychologist', category: 'services', mode: 'service', blurb: 'Helps with pressure and bad runs.', price: 0, upkeep: 175,
    effects: ['£175 a week', 'Confidence recovers to a higher resting level after bad games'] },
  { id: 'svc_pa', name: 'Personal assistant', category: 'services', mode: 'service', blurb: 'Handles the admin so you can stay in touch with people.', price: 0, upkeep: 150, minAge: 18,
    effects: ['£150 a week', 'Relationships fade half as quickly when you are busy'] },
  // ---- entertainment
  { id: 'ent_cinema', name: 'Cinema night', category: 'entertainment', mode: 'experience', blurb: 'Switch off for a few hours.', price: 30, upkeep: 0, morale: 1.5, cooldownDays: 3,
    effects: ['Morale +1.5', 'Repeatable every 3 days'] },
  { id: 'ent_dinner', name: 'Dinner out with friends', category: 'entertainment', mode: 'experience', blurb: 'A proper catch-up.', price: 65, upkeep: 0, morale: 2.5, rel: { friend: 2 }, cooldownDays: 5,
    effects: ['Morale +2.5', 'Friend relationship +2', 'Repeatable every 5 days'] },
  { id: 'ent_concert', name: 'Concert tickets', category: 'entertainment', mode: 'experience', blurb: 'A night you will remember.', price: 180, upkeep: 0, morale: 4, fatigue: 4, rel: { friend: 3 }, cooldownDays: 21, freeDays: 2,
    effects: ['Morale +4, fatigue +4', 'Friend relationship +3', 'Needs two clear days before your next match', 'Repeatable every 21 days'] },
  { id: 'ent_gaming', name: 'Gaming and home cinema setup', category: 'entertainment', mode: 'owned', blurb: 'Time off the pitch, spent well.', price: 1800, upkeep: 0, morale: 3, mood: 0.7,
    effects: ['One-off cost', 'Small, permanent mood lift'] },
  { id: 'ent_party', name: 'Throw a party for friends and family', category: 'entertainment', mode: 'experience', blurb: 'Bring everyone together.', price: 950, upkeep: 0, morale: 5, fatigue: 8, rel: { friend: 6, family: 3 }, cooldownDays: 60, freeDays: 2, minAge: 18,
    effects: ['Morale +5, fatigue +8', 'Friends +6, family +3', 'Needs two clear days before your next match', 'Repeatable every 60 days'] },
];

export const catalogItem = (id: string): CatalogItem | undefined => CATALOG.find((c) => c.id === id);

export const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  housing: 'Housing', cars: 'Cars', clothing: 'Clothing', travel: 'Travel', services: 'Personal services', entertainment: 'Entertainment',
};

export interface InvestmentItem {
  id: string;
  name: string;
  type: Investment['type'];
  blurb: string;
  cost: number;
  /** 0..1, how wide the outcomes are and how likely a bad one is */
  risk: number;
  /** expected total return a year (income plus change in value) */
  expectedAnnual: number;
  /** share of the return paid out as cash each quarter; the rest shows up in the value */
  cashShare: number;
}

export const INVESTMENTS: InvestmentItem[] = [
  { id: 'inv_studio', name: 'Studio flat to rent out', type: 'property', blurb: 'A small flat in a university town. Steady, unexciting.', cost: 25000, risk: 0.15, expectedAnnual: 0.07, cashShare: 0.55 },
  { id: 'inv_flats', name: 'Block of three flats', type: 'property', blurb: 'More rent, more upkeep, more exposure to the local market.', cost: 120000, risk: 0.22, expectedAnnual: 0.085, cashShare: 0.55 },
  { id: 'inv_commercial', name: 'Small commercial unit', type: 'property', blurb: 'Let to local shops. Good when the high street is busy.', cost: 600000, risk: 0.32, expectedAnnual: 0.105, cashShare: 0.5 },
  { id: 'inv_cafe', name: 'Neighbourhood café', type: 'business', blurb: 'Co-own a café run by someone who knows what they are doing.', cost: 15000, risk: 0.55, expectedAnnual: 0.16, cashShare: 0.6 },
  { id: 'inv_gym', name: 'Gym franchise', type: 'business', blurb: 'A franchise unit with your name on the wall.', cost: 60000, risk: 0.45, expectedAnnual: 0.14, cashShare: 0.5 },
  { id: 'inv_restaurant', name: 'Restaurant partnership', type: 'business', blurb: 'High margins when it works; plenty of restaurants do not.', cost: 150000, risk: 0.62, expectedAnnual: 0.19, cashShare: 0.5 },
  { id: 'inv_startup', name: 'Early-stage tech start-up', type: 'venture', blurb: 'A founder you trust and a product that does not exist yet.', cost: 10000, risk: 0.82, expectedAnnual: 0.3, cashShare: 0 },
  { id: 'inv_sporttech', name: 'Sports-science company', type: 'venture', blurb: 'Wearables and recovery tech used by clubs.', cost: 50000, risk: 0.7, expectedAnnual: 0.24, cashShare: 0 },
  { id: 'inv_esports', name: 'Esports team stake', type: 'venture', blurb: 'A share of a growing team. Valuations swing wildly.', cost: 250000, risk: 0.78, expectedAnnual: 0.27, cashShare: 0 },
];

export const investmentItem = (id: string): InvestmentItem | undefined => INVESTMENTS.find((c) => c.id === id);

const REVIEW_DAYS = 91;
const MAX_ACTIVE_INVESTMENTS = 8;

/* ================================================================== helpers */

const fail = (message: string): ActionResult => ({ ok: false, message });
const ok = (message: string): ActionResult => ({ ok: true, message });

export function relOf(state: GameState, id: string): Relationship | undefined {
  return state.relationships.find((r) => r.id === id);
}

function relByKind(state: GameState, kind: Relationship['kind']): Relationship | undefined {
  return state.relationships.find((r) => r.kind === kind);
}

export function bumpRel(state: GameState, rel: Relationship | undefined, delta: number): void {
  if (!rel) return;
  rel.value = clamp(Math.round((rel.value + delta) * 10) / 10, 0, 100);
  rel.lastEventDay = state.day;
  if (rel.kind === 'agent') state.transfers.agent.relationship = rel.value;
}

export function adjustRep(state: GameState, delta: Partial<Reputation>): void {
  const r = state.reputation;
  for (const k of Object.keys(delta) as (keyof Reputation)[]) r[k] = clamp(Math.round((r[k] + (delta[k] ?? 0)) * 100) / 100, 0, 100);
}

function mood(state: GameState, morale: number, confidence = 0, fatigue = 0): void {
  const c = userPlayer(state).cond;
  c.morale = clamp(c.morale + morale, 5, 100);
  c.confidence = clamp(c.confidence + confidence, 5, 100);
  c.fatigue = clamp(c.fatigue + fatigue, 0, 100);
}

export function daysToNextMatch(state: GameState): number {
  const n = nextUserFixture(state);
  return n ? Math.max(0, n.fixture.day - state.day) : 999;
}

export const hasPurchase = (state: GameState, catalogId: string) => state.finance.purchases.some((p) => p.catalogId === catalogId);

export function housingItem(state: GameState): CatalogItem {
  return catalogItem(state.finance.housing) ?? (catalogItem('home_family') as CatalogItem);
}

/** Resting mood shift from belongings, home, services and the people around you, capped so nothing dominates football. */
export function lifeMoodBonus(state: GameState): { total: number; parts: { label: string; value: number }[] } {
  const parts: { label: string; value: number }[] = [];
  const h = housingItem(state);
  if ((h.comfort ?? 0) > 1) parts.push({ label: 'Home', value: ((h.comfort ?? 0) - 1) * 0.6 });
  for (const pu of state.finance.purchases) {
    const it = catalogItem(pu.catalogId);
    if (it?.mood) parts.push({ label: it.name, value: it.mood });
  }
  if (hasPurchase(state, 'svc_chef')) parts.push({ label: 'Private chef', value: 0.5 });
  for (const r of state.relationships) {
    if (r.kind === 'family' || r.kind === 'friend' || r.kind === 'partner') {
      if (r.value >= 70) parts.push({ label: r.name, value: 1.2 });
      else if (r.value <= 30) parts.push({ label: r.name, value: -2.2 });
    } else if (r.kind === 'manager') {
      if (r.value >= 70) parts.push({ label: 'Manager', value: 1 });
      else if (r.value <= 30) parts.push({ label: 'Manager', value: -2 });
    }
  }
  const total = clamp(parts.reduce((s, p) => s + p.value, 0), -6, 6);
  return { total, parts };
}

/* ================================================================== the shop */

export function itemStatus(state: GameState, item: CatalogItem): { ok: boolean; reason?: string } {
  const user = userPlayer(state);
  const age = ageAt(user.birthDay, state.day);
  if (state.career.retired) return { ok: false, reason: 'Your career is over.' };
  if (item.minAge && age < item.minAge) return { ok: false, reason: `You must be ${item.minAge} or older.` };
  if (item.mode === 'housing') {
    if (state.finance.housing === item.id) return { ok: false, reason: 'You already live here.' };
  } else if (item.mode !== 'experience' && hasPurchase(state, item.id)) {
    return { ok: false, reason: item.mode === 'service' ? 'You already have this.' : 'You already own this.' };
  }
  if (item.mode === 'experience' && item.cooldownDays) {
    const last = state.flags[`cool:${item.id}`];
    if (typeof last === 'number' && state.day - last < item.cooldownDays) {
      return { ok: false, reason: `Available again in ${item.cooldownDays - (state.day - last)} days.` };
    }
  }
  if (item.freeDays && daysToNextMatch(state) < item.freeDays) {
    return { ok: false, reason: `You have a match in ${daysToNextMatch(state)} days. This needs ${item.freeDays} clear days.` };
  }
  // moving out of a home you own sells it, which helps pay for the next one
  const cur = item.mode === 'housing' ? state.finance.purchases.find((p) => p.category === 'housing') : undefined;
  const refund = cur ? resaleValue(state, cur) : 0;
  if (item.price > state.finance.balance + refund) return { ok: false, reason: `You need ${money(item.price - state.finance.balance - refund)} more.` };
  return { ok: true };
}

function applyEffects(state: GameState, item: CatalogItem): string[] {
  const out: string[] = [];
  mood(state, item.morale ?? 0, item.confidence ?? 0, item.fatigue ?? 0);
  if (item.morale) out.push(`morale ${item.morale > 0 ? '+' : ''}${item.morale}`);
  if (item.fatigue) out.push(`fatigue ${item.fatigue > 0 ? '+' : ''}${item.fatigue}`);
  if (item.rep) adjustRep(state, item.rep);
  if (item.rel?.family) { bumpRel(state, relByKind(state, 'family'), item.rel.family); out.push(`family +${item.rel.family}`); }
  if (item.rel?.friend) { bumpRel(state, relByKind(state, 'friend'), item.rel.friend); out.push(`friend +${item.rel.friend}`); }
  if (item.rel?.partner) bumpRel(state, relByKind(state, 'partner'), item.rel.partner);
  return out;
}

export function buyItem(state: GameState, catalogId: string): ActionResult {
  const item = catalogItem(catalogId);
  if (!item) return fail('That item is not available.');
  const st = itemStatus(state, item);
  if (!st.ok) return fail(st.reason ?? 'You cannot do that.');
  const f = state.finance;

  if (item.mode === 'housing') {
    const old = housingItem(state);
    // moving out of an owned home sells it at its current value
    let refund = 0;
    const oldPurchase = f.purchases.find((p) => p.category === 'housing');
    if (oldPurchase) {
      refund = oldPurchase.catalogId === 'home_family' ? 0 : resaleValue(state, oldPurchase);
      f.purchases = f.purchases.filter((p) => p.id !== oldPurchase.id);
    }
    if (item.price > f.balance + refund) {
      if (oldPurchase) f.purchases.push(oldPurchase);
      return fail(`You need ${money(item.price - f.balance - refund)} more.`);
    }
    if (refund > 0) post(state, 'purchase', `Sold ${old.name}`, refund);
    if (item.price > 0) post(state, 'purchase', `${item.resale ? 'Bought' : 'Deposit and moving costs'}: ${item.name}`, -item.price);
    f.housing = item.id;
    f.purchases.push({ id: uid(state, 'pur'), catalogId: item.id, name: item.name, category: 'housing', day: state.day, price: item.price, upkeep: item.upkeep });
    mood(state, item.id === 'home_family' ? 0 : 2);
    if (item.rep) adjustRep(state, item.rep);
    if (item.resale === 'home' && item.id === 'house_own') unlock(state, 'first_home', `Bought ${item.name.toLowerCase()}.`);
    if (item.id === 'villa') unlock(state, 'first_home', 'Bought a luxury villa.');
    if (item.id !== 'home_family' && old.id === 'home_family') bumpRel(state, relByKind(state, 'family'), -2);
    addNews(state, 'life', `${userPlayer(state).displayName} moves to a new home`, `${item.name}. ${item.upkeep ? `It costs ${money(item.upkeep)} a week.` : ''}`.trim(), {});
    return ok(`You moved: ${item.name}${refund ? ` (sold your old home for ${money(refund)})` : ''}.`);
  }

  post(state, 'purchase', item.mode === 'service' ? `Started: ${item.name}` : `Bought: ${item.name}`, -item.price);
  const rec: Purchase = { id: uid(state, 'pur'), catalogId: item.id, name: item.name, category: item.category, day: state.day, price: item.price, upkeep: item.upkeep };
  f.purchases.push(rec);
  if (item.mode === 'experience') {
    state.flags[`cool:${item.id}`] = state.day;
    // keep the shop history tidy: experiences stay in the ledger, only the latest few stay in the purchases list
    const exps = f.purchases.filter((p) => catalogItem(p.catalogId)?.mode === 'experience');
    if (exps.length > 30) {
      const drop = new Set(exps.slice(0, exps.length - 30).map((p) => p.id));
      f.purchases = f.purchases.filter((p) => !drop.has(p.id));
    }
  }
  const bits = applyEffects(state, item);
  if (item.mode === 'owned' && item.price >= 50000) {
    addNews(state, 'life', `${userPlayer(state).displayName} buys a ${item.name.toLowerCase()}`, `${money(item.price)}.`, {});
  }
  return ok(`${item.mode === 'service' ? 'Started' : 'Bought'}: ${item.name} for ${item.price ? money(item.price) : money(item.upkeep) + ' a week'}${bits.length ? ` (${bits.join(', ')})` : ''}.`);
}

export function resaleValue(state: GameState, p: Purchase): number {
  const it = catalogItem(p.catalogId);
  const years = Math.max(0, (state.day - p.day) / 365.25);
  if (it?.resale === 'car') return roundMoney(p.price * Math.max(0.3, 1 - 0.14 * years));
  if (it?.resale === 'home') return roundMoney(p.price * Math.pow(1.03, years) * 0.97);
  return 0;
}

export function sellPurchase(state: GameState, purchaseId: string): ActionResult {
  const p = state.finance.purchases.find((x) => x.id === purchaseId);
  if (!p) return fail('You do not own that.');
  const it = catalogItem(p.catalogId);
  if (!it?.resale || it.mode === 'housing') return fail('That cannot be sold.');
  const v = resaleValue(state, p);
  state.finance.purchases = state.finance.purchases.filter((x) => x.id !== purchaseId);
  post(state, 'purchase', `Sold: ${p.name}`, v);
  return ok(`Sold ${p.name} for ${money(v)}.`);
}

export function cancelService(state: GameState, purchaseId: string): ActionResult {
  const p = state.finance.purchases.find((x) => x.id === purchaseId);
  const it = p ? catalogItem(p.catalogId) : undefined;
  if (!p || it?.mode !== 'service') return fail('That is not a service you can cancel.');
  state.finance.purchases = state.finance.purchases.filter((x) => x.id !== purchaseId);
  return ok(`Cancelled ${p.name}. You will no longer pay ${money(p.upkeep)} a week.`);
}

/* ================================================================== investments */

export function investmentStatus(state: GameState, item: InvestmentItem): { ok: boolean; reason?: string } {
  const age = ageAt(userPlayer(state).birthDay, state.day);
  if (state.career.retired) return { ok: false, reason: 'Your career is over.' };
  if (age < 18) return { ok: false, reason: 'You must be 18 or older to invest.' };
  const active = state.finance.investments.filter((i) => i.status === 'active');
  if (active.length >= MAX_ACTIVE_INVESTMENTS) return { ok: false, reason: `You can hold at most ${MAX_ACTIVE_INVESTMENTS} investments.` };
  if (active.filter((i) => i.catalogId === item.id).length >= 2) return { ok: false, reason: 'You already hold two of these.' };
  if (item.cost > state.finance.balance) return { ok: false, reason: `You need ${money(item.cost - state.finance.balance)} more.` };
  return { ok: true };
}

export function invest(state: GameState, catalogId: string): ActionResult {
  const item = investmentItem(catalogId);
  if (!item) return fail('That opportunity is not available.');
  const st = investmentStatus(state, item);
  if (!st.ok) return fail(st.reason ?? 'You cannot invest in that.');
  post(state, 'investment', `Invested: ${item.name}`, -item.cost);
  const inv: Investment = {
    id: uid(state, 'inv'), catalogId: item.id, name: item.name, type: item.type, cost: item.cost, startDay: state.day, risk: item.risk,
    expectedAnnual: item.expectedAnnual, value: item.cost, incomeTotal: 0, lastReviewDay: state.day, status: 'active', history: [],
  };
  state.finance.investments.push(inv);
  unlock(state, 'investor', `Invested in ${item.name.toLowerCase()}.`);
  return ok(`You invested ${money(item.cost)} in ${item.name}. It is reviewed every quarter.`);
}

export function sellInvestment(state: GameState, id: string): ActionResult {
  const inv = state.finance.investments.find((i) => i.id === id);
  if (!inv || inv.status !== 'active') return fail('That investment cannot be sold.');
  const haircut = inv.type === 'property' ? 0.03 : inv.type === 'business' ? 0.08 : 0.12;
  const proceeds = roundMoney(inv.value * (1 - haircut));
  inv.status = 'sold';
  inv.history.push({ day: state.day, change: proceeds - inv.value, note: `Sold for ${money(proceeds)} after a ${Math.round(haircut * 100)}% selling cost.` });
  if (proceeds > 0) post(state, 'investment_return', `Sold: ${inv.name}`, proceeds);
  const gain = proceeds + inv.incomeTotal - inv.cost;
  return ok(`Sold ${inv.name} for ${money(proceeds)}. Overall ${gain >= 0 ? 'profit' : 'loss'} including income: ${money(Math.abs(gain))}.`);
}

/** One quarterly review of every active investment. Outcomes depend only on the seed, the investment and the quarter. */
export function reviewInvestments(state: GameState): void {
  for (const inv of state.finance.investments) {
    if (inv.status !== 'active') continue;
    let guard = 0;
    while (state.day - inv.lastReviewDay >= REVIEW_DAYS && guard++ < 8) {
      inv.lastReviewDay += REVIEW_DAYS;
      const quarter = Math.round((inv.lastReviewDay - inv.startDay) / REVIEW_DAYS);
      const rng = new Rng(seedFrom(state.seed, 'inv', inv.id, quarter));
      const item = investmentItem(inv.catalogId);
      const cashShare = item?.cashShare ?? 0;
      const expected = inv.expectedAnnual / 4;
      const noise = rng.normal(0, inv.risk * 0.1);
      let note = '';
      let valueChange = inv.value * (expected * (1 - cashShare) + noise);
      const cash = inv.cost * expected * cashShare * Math.max(0, 1 + rng.normal(0, inv.risk * 0.5));
      const shock = rng.next() < inv.risk * 0.1;
      const boom = !shock && rng.next() < inv.risk * 0.05;
      if (shock) {
        const hit = rng.range(0.18, 0.55);
        valueChange -= inv.value * hit;
        note = inv.type === 'property' ? 'The local market turned and the property lost value.' : inv.type === 'business' ? 'A bad quarter: costs rose and customers stayed away.' : 'A funding round went badly and the valuation was marked down.';
      } else if (boom) {
        const gain = rng.range(0.2, 0.6);
        valueChange += inv.value * gain;
        note = inv.type === 'property' ? 'Demand in the area jumped and the property was revalued.' : inv.type === 'business' ? 'A strong quarter: new customers and better margins.' : 'A new investor valued the company far higher.';
      }
      inv.value = Math.max(0, Math.round(inv.value + valueChange));
      const cashPaid = shock ? Math.round(cash * 0.3) : Math.round(cash);
      if (cashPaid > 0) {
        post(state, 'investment_return', `Income: ${inv.name}`, cashPaid);
        inv.incomeTotal += cashPaid;
      }
      inv.history.push({ day: inv.lastReviewDay, change: Math.round(valueChange), note: note || `Quarter ${quarter}: ${valueChange >= 0 ? 'value up' : 'value down'}${cashPaid ? `, income ${money(cashPaid)}` : ''}.` });
      if (inv.history.length > 40) inv.history.shift();
      if (inv.type !== 'property' && inv.value < inv.cost * 0.12) {
        inv.status = 'failed';
        inv.value = 0;
        inv.history.push({ day: inv.lastReviewDay, change: 0, note: 'The venture failed and your stake is worthless.' });
        addNews(state, 'life', `Your ${inv.name.toLowerCase()} investment has failed`, `The stake is now worthless. You put in ${money(inv.cost)} and received ${money(inv.incomeTotal)} in income.`, { important: true });
        break;
      }
      if (shock || boom) {
        addNews(state, 'life', `${inv.name}: ${shock ? 'setback' : 'good news'}`, `${note} Your stake is now worth ${money(inv.value)}.`, { important: shock });
      }
    }
  }
}

/* ================================================================== sponsorships */

const BRANDS: Record<Sponsorship['category'], string[]> = {
  boots: ['Strikewear', 'Kickforge', 'Volta Boots', 'Pitchline'],
  apparel: ['Northcast Apparel', 'Halden Sport', 'Aurelle', 'Tidewater Co.'],
  drink: ['Zestora Energy', 'Pure Spring', 'Rally Isotonic', 'Brightfizz'],
  local: ['Marlow Motors', 'Carter & Sons Builders', 'Greenfield Dairy', 'Eastgate Opticians', 'Quayside Fitness'],
  watch: ['Meridian Watches', 'Kestrel Time', 'Orrin & Vale'],
  tech: ['Glintlink', 'Pulseware', 'Nimbus Audio', 'Coreplay'],
  car: ['Valerio Motors', 'Haldane Cars', 'Orion Auto'],
  charity: ['Kids Kick Foundation'],
};

const CATEGORY_NAME: Record<Sponsorship['category'], string> = {
  boots: 'boot', apparel: 'clothing', drink: 'drinks', local: 'local business', watch: 'watch', tech: 'technology', car: 'motor', charity: 'charity',
};

/** 0..100 measure of how marketable you are. */
export function marketability(state: GameState): number {
  const r = state.reputation;
  return clamp(r.media * 0.45 + r.fans * 0.35 + r.professional * 0.2, 0, 100);
}

export function activeSponsorships(state: GameState): Sponsorship[] {
  return state.finance.sponsorships.filter((s) => s.status === 'active');
}

function sponsorOffer(state: GameState, rng: Rng): { brand: string; category: Sponsorship['category']; weekly: number; weeks: number } | null {
  const s = marketability(state);
  const have = new Set(activeSponsorships(state).map((x) => x.category));
  const pools: Sponsorship['category'][] = [];
  if (s >= 14) pools.push('local');
  if (s >= 22) pools.push('boots');
  if (s >= 32) pools.push('apparel', 'drink', 'tech');
  if (s >= 50) pools.push('watch', 'car');
  const options = pools.filter((c) => !have.has(c));
  if (!options.length) return null;
  const category = rng.pick(options);
  const brand = rng.pick(BRANDS[category]);
  const weekly = roundWage(Math.pow(s / 10, 2.3) * 22 * rng.range(0.8, 1.25));
  if (weekly < 40) return null;
  return { brand, category, weekly, weeks: rng.pick([26, 52, 78, 104]) };
}

function resolveSponsor(state: GameState, d: PendingDecision, option: string, rng: Rng): string {
  const p = d.payload as { brand: string; category: Sponsorship['category']; weekly: number; weeks: number };
  if (option === 'decline') return `You turned down ${p.brand}.`;
  let weekly = p.weekly;
  if (option === 'negotiate') {
    const chance = clamp(0.35 + state.transfers.agent.quality * 0.02 + (state.transfers.agent.relationship - 50) * 0.002, 0.15, 0.85);
    if (!rng.chance(chance)) return `${state.transfers.agent.name} pushed too hard and ${p.brand} walked away.`;
    weekly = roundWage(weekly * 1.18);
  }
  const sp: Sponsorship = {
    id: uid(state, 'sp'), brand: p.brand, category: p.category, weekly, startDay: state.day, endDay: state.day + p.weeks * 7, status: 'active', paid: 0,
  };
  state.finance.sponsorships.push(sp);
  unlock(state, 'first_sponsor', `Signed with ${p.brand}.`);
  adjustRep(state, { media: 0.8 });
  addNews(state, 'life', `${userPlayer(state).displayName} signs with ${p.brand}`, `A ${p.weeks}-week ${CATEGORY_NAME[p.category]} deal worth ${money(weekly)} a week before tax and commission.`, { important: true });
  return `You signed with ${p.brand}: ${money(weekly)} a week for ${p.weeks} weeks.`;
}

function paySponsors(state: GameState): void {
  for (const sp of state.finance.sponsorships) {
    if (sp.status !== 'active') continue;
    if (state.day >= sp.endDay) {
      sp.status = 'ended';
      addNews(state, 'life', `${sp.brand} deal ends`, `Your ${CATEGORY_NAME[sp.category]} sponsorship has run its course. It paid ${money(sp.paid)} in total before tax.`, {});
      continue;
    }
    if (!claim(state, `spons:${sp.id}:${state.day}`)) continue;
    const agentFee = Math.round(sp.weekly * (state.transfers.agent.feePct / 100));
    const tax = Math.round(sp.weekly * 0.3);
    post(state, 'sponsorship', `${sp.brand} sponsorship`, sp.weekly);
    state.finance.careerEarnings += sp.weekly;
    if (agentFee) post(state, 'agent_fee', `Agent fee on ${sp.brand} deal`, -agentFee);
    post(state, 'tax', `Tax on ${sp.brand} income`, -tax);
    sp.paid += sp.weekly;
  }
}

/* ================================================================== reputation and relationships */

export function reputationLabel(v: number): string {
  if (v >= 85) return 'Global';
  if (v >= 70) return 'Superstar';
  if (v >= 55) return 'Famous';
  if (v >= 40) return 'Well known';
  if (v >= 25) return 'Known locally';
  if (v >= 12) return 'Emerging';
  return 'Unknown';
}

const ROLE_CLUB_BONUS: Record<string, number> = {
  'Key player': 25, 'Regular starter': 18, 'Important player': 10, 'Rotation option': 2, 'Fringe player': -8, 'Youth prospect': 0,
};

export function updateReputation(state: GameState): void {
  const user = userPlayer(state);
  const r = state.reputation;
  const ovr = overall(user);
  const awards = state.awards.filter((a) => a.playerId === state.userId).length;
  const aim = (cur: number, target: number, rate: number) => clamp(cur + (clamp(target, 0, 100) - cur) * rate, 0, 100);
  const caps = state.international.caps;
  r.professional = aim(r.professional, (ovr - 35) * 1.5 + Math.min(10, awards * 2) + Math.min(6, caps * 0.15), 0.04);

  const ratings = user.recentRatings.slice(-8);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 6.2;
  const goals = (user.stats.league?.goals ?? 0) + (user.stats.cup?.goals ?? 0);
  const spell = user.clubId ? state.career.clubSpellStart[user.clubId] ?? state.day : state.day;
  const years = (state.day - spell) / 365.25;
  const clubRep = user.clubId ? state.clubs[user.clubId].reputation : 30;
  r.fans = aim(r.fans, 6 + goals * 1.1 + (avg - 6.3) * 14 + years * 3 + clubRep * 0.12 + Math.min(8, state.career.trophies.length * 2), 0.03);

  const important = state.news.filter((n) => n.important && state.day - n.day <= 60).length;
  r.media = aim(r.media, r.professional * 0.5 + r.national * 0.3 + Math.min(12, important * 0.8) + goals * 0.2, 0.05);

  if (user.clubId) {
    const share = clamp(((user.stats.league?.minutes ?? 0) + (user.stats.cup?.minutes ?? 0)) / 2700, 0, 1);
    r.club = aim(r.club, 18 + (state.career.managerTrust - 50) * 0.45 + share * 28 + years * 4 + (ROLE_CLUB_BONUS[state.career.squadRole] ?? 0) * 0.4, 0.05);
  }
  r.national = clamp(r.national - (state.international.calledUpNow ? 0 : 0.05), 0, 100);
  for (const k of Object.keys(r) as (keyof Reputation)[]) r[k] = Math.round(r[k] * 100) / 100;
  // the number the market sees
  user.reputation = clamp(Math.round(r.professional * 0.5 + r.fans * 0.2 + r.media * 0.15 + r.club * 0.15), 3, 99);
}

function driftRelationships(state: GameState): void {
  const pa = hasPurchase(state, 'svc_pa');
  const home = state.finance.housing === 'home_family';
  for (const r of state.relationships) {
    const idle = r.lastEventDay === undefined ? 999 : state.day - r.lastEventDay;
    if (r.kind === 'family' || r.kind === 'friend' || r.kind === 'partner') {
      if (idle > 60 && r.value > 25) r.value = Math.max(25, r.value - (pa ? 0.3 : 0.6));
      if (r.kind === 'family' && home && r.value < 90) r.value = Math.min(90, r.value + 0.12);
    } else if (r.kind === 'manager') {
      const mgr = state.career.managerTrust;
      r.value = clamp(r.value + (mgr - r.value) * 0.05, 0, 100);
    } else if (r.kind === 'agent') {
      r.value = clamp(state.transfers.agent.relationship, 0, 100);
    } else if (r.kind === 'teammate' && r.playerId) {
      const mate = state.players[r.playerId];
      const same = mate?.clubId && mate.clubId === userPlayer(state).clubId;
      if (same && r.value < 70) r.value = Math.min(70, r.value + 0.1);
      else if (!same) r.value = Math.max(20, r.value - 0.2);
    }
    r.value = Math.round(r.value * 10) / 10;
  }
}

/** Anything that makes a partner relationship end: it fades when ignored for a long time. */
function partnerCheck(state: GameState): void {
  const p = relByKind(state, 'partner');
  if (!p) return;
  if (p.value < 12) {
    state.relationships = state.relationships.filter((r) => r.id !== p.id);
    mood(state, -5, -2);
    state.flags.partnerEndedDay = state.day;
    addNews(state, 'life', `${userPlayer(state).displayName} and ${p.name} split up`, 'The relationship faded as it was given too little time.', {});
  }
}

/* ================================================================== decisions */

interface Built {
  title: string;
  body: string;
  options: DecisionOption[];
  default: string;
  days: number;
  payload?: Record<string, unknown>;
}

interface LifeEventDef {
  id: string;
  weight: (state: GameState) => number;
  build: (state: GameState, rng: Rng) => Built | null;
  resolve: (state: GameState, option: string, d: PendingDecision, rng: Rng) => string;
}

const clubRoleLow = (s: GameState) => ['Fringe player', 'Rotation option', 'Youth prospect'].includes(s.career.squadRole);

function giftCost(state: GameState): number {
  const wage = userPlayer(state).contract?.wage ?? 100;
  return Math.min(state.finance.balance, roundMoney(clamp(wage * 0.4, 30, 800)));
}

const EVENTS: LifeEventDef[] = [
  {
    id: 'family_event',
    weight: (s) => (relByKind(s, 'family') ? (relByKind(s, 'family')!.value < 45 ? 4 : 2.5) : 0),
    build: (s, rng) => {
      const what = rng.pick(['a cousin’s wedding', 'your grandmother’s birthday', 'a family christening', 'a reunion that happens once every few years']);
      return {
        title: 'Family occasion', body: `Your family are getting together for ${what}. They would love you to be there.`, default: 'decline', days: 6,
        options: [
          { id: 'attend', label: 'Go and celebrate with them', detail: 'Family +7, morale +3, a tiring day' },
          { id: 'gift', label: 'Send a gift and call', detail: `Family +3. Costs ${money(giftCost(s))}` },
          { id: 'decline', label: 'Stay focused on football', detail: 'Family -5' },
        ],
      };
    },
    resolve: (s, o) => {
      const fam = relByKind(s, 'family');
      if (o === 'attend') {
        const near = daysToNextMatch(s) <= 2;
        bumpRel(s, fam, 7); mood(s, 3, 0, near ? 12 : 5);
        return near ? 'You went, and it was a lovely day, but with a match coming up you arrived back tired.' : 'You spent the day with your family. Everyone was glad you came.';
      }
      if (o === 'gift') {
        const c = giftCost(s);
        if (c > 0) post(s, 'gift', 'Family gift', -c);
        bumpRel(s, fam, 3); mood(s, 1);
        return 'You sent a thoughtful gift and called everyone. They understood.';
      }
      bumpRel(s, fam, -5); mood(s, -1);
      return 'You stayed away. Your family said they understood, but it stung a little.';
    },
  },
  {
    id: 'family_request',
    weight: (s) => (relByKind(s, 'family') && s.finance.balance >= 800 && ageAt(userPlayer(s).birthDay, s.day) >= 18 ? 1.2 : 0),
    build: (s, rng) => {
      const amount = Math.round(clamp(s.finance.balance * 0.1, 150, 25000) / 50) * 50;
      const why = rng.pick(['a car repair', 'helping with a deposit on a flat', 'a medical bill', 'a course they want to take']);
      return {
        title: 'A relative needs help', body: `A relative asks if you could help with ${why}. They need ${money(amount)}.`, default: 'decline', days: 10, payload: { amount },
        options: [
          { id: 'help', label: `Pay ${money(amount)}`, detail: 'Family +9, morale +2' },
          { id: 'part', label: `Pay half (${money(amount / 2)})`, detail: 'Family +4' },
          { id: 'decline', label: 'Politely say no', detail: 'Family -4, morale -1' },
        ],
      };
    },
    resolve: (s, o, d) => {
      const amount = Number(d.payload?.amount ?? 0);
      const fam = relByKind(s, 'family');
      if (o === 'help' && amount <= s.finance.balance) { post(s, 'gift', 'Helped a relative', -amount); bumpRel(s, fam, 9); mood(s, 2); return `You paid ${money(amount)}. They were very grateful.`; }
      if (o === 'part' && amount / 2 <= s.finance.balance) { post(s, 'gift', 'Helped a relative', -amount / 2); bumpRel(s, fam, 4); return `You paid ${money(amount / 2)}, which helped.`; }
      bumpRel(s, fam, -4); mood(s, -1);
      return 'You said no. It was an awkward conversation.';
    },
  },
  {
    id: 'friend_night_out',
    weight: (s) => (relByKind(s, 'friend') ? 2 : 0),
    build: (s) => ({
      title: 'Your friend is in town', body: `${relByKind(s, 'friend')!.name.replace(/ \(.*\)/, '')} is back for the night and wants to go out.`, default: 'stay', days: 4,
      options: [
        { id: 'out', label: 'Go out', detail: 'Friend +6, morale +4, tiring' },
        { id: 'home', label: 'Have them round instead', detail: 'Friend +4, morale +2' },
        { id: 'stay', label: 'Stay in and rest', detail: 'Friend -3, fatigue down' },
      ],
    }),
    resolve: (s, o) => {
      const fr = relByKind(s, 'friend');
      if (o === 'out') {
        const soon = daysToNextMatch(s) <= 1;
        bumpRel(s, fr, 6); mood(s, 4, 0, soon ? 18 : 10);
        return soon ? 'A great night, but you were running on empty with a match so close.' : 'A great night out. You will pay for it a little tomorrow.';
      }
      if (o === 'home') { bumpRel(s, fr, 4); mood(s, 2); return 'A relaxed evening in. Exactly what you both needed.'; }
      bumpRel(s, fr, -3); mood(s, -0.5, 0, -4);
      return 'You rested. Your friend was understanding, though a bit disappointed.';
    },
  },
  {
    id: 'teammate_struggle',
    weight: (s) => (s.relationships.some((r) => r.kind === 'teammate') ? 1.5 : 0),
    build: (s) => {
      const t = s.relationships.filter((r) => r.kind === 'teammate');
      const pick = t[Math.floor(((s.day * 7) % 100) / 100 * t.length)] ?? t[0];
      return {
        title: `${pick.name} is struggling`, body: `${pick.name} has been out of form and short of confidence. You are one of the few people he has opened up to.`, default: 'ignore', days: 8, payload: { relId: pick.id },
        options: [
          { id: 'help', label: 'Spend extra time with him', detail: 'Relationship +9, club reputation +2, a little tiring' },
          { id: 'advice', label: 'Give him some advice', detail: 'Relationship +4' },
          { id: 'ignore', label: 'Leave him to it', detail: 'Relationship -4' },
        ],
      };
    },
    resolve: (s, o, d) => {
      const rel = relOf(s, String(d.payload?.relId));
      if (o === 'help') { bumpRel(s, rel, 9); adjustRep(s, { club: 2, professional: 0.3 }); mood(s, 2, 0, 5); return `You put in the time with ${rel?.name ?? 'him'}. He came through it, and the dressing room noticed.`; }
      if (o === 'advice') { bumpRel(s, rel, 4); mood(s, 0.5); return 'Your advice helped a little.'; }
      bumpRel(s, rel, -4); adjustRep(s, { club: -0.5 });
      return 'You kept your distance. He noticed.';
    },
  },
  {
    id: 'teammate_advice',
    weight: (s) => (relOf(s, 'rel_mentor') ? 1.5 : 0),
    build: (s) => ({
      title: 'Advice from an experienced team-mate', body: `${relOf(s, 'rel_mentor')!.name} offers to go through your game with you after training.`, default: 'brush', days: 6,
      options: [
        { id: 'listen', label: 'Listen and work on it', detail: 'Relationship +5, confidence +2, training impression +4' },
        { id: 'brush', label: 'Say you are fine', detail: 'Relationship -3' },
      ],
    }),
    resolve: (s, o) => {
      const rel = relOf(s, 'rel_mentor');
      if (o === 'listen') { bumpRel(s, rel, 5); mood(s, 0, 2); s.career.trainingPerformance = clamp(s.career.trainingPerformance + 4, 0, 100); return 'You picked up a few things that you started using straight away.'; }
      bumpRel(s, rel, -3);
      return 'You declined. He shrugged and left it.';
    },
  },
  {
    id: 'manager_meeting',
    weight: (s) => (s.career.retired ? 0 : clubRoleLow(s) && s.career.managerTrust < 60 ? 2.5 : 0.3),
    build: (s) => ({
      title: 'A word with the manager', body: `${userPlayer(s).clubId ? s.clubs[userPlayer(s).clubId as string].manager.name : 'The manager'} has asked how you feel about your role in the squad.`, default: 'quiet', days: 7,
      options: [
        { id: 'improve', label: 'Ask what you need to improve', detail: 'Manager relationship +4, trust +4' },
        { id: 'demand', label: 'Say you deserve more game time', detail: 'Works if training has gone well; otherwise it backfires' },
        { id: 'quiet', label: 'Say you are happy', detail: 'No change' },
      ],
    }),
    resolve: (s, o, d, rng) => {
      const rel = relByKind(s, 'manager');
      if (o === 'improve') { bumpRel(s, rel, 4); s.career.managerTrust = clamp(s.career.managerTrust + 4, 0, 100); s.career.trainingPerformance = clamp(s.career.trainingPerformance + 2, 0, 100); return 'He gave you straight answers. You know exactly what he wants to see.'; }
      if (o === 'demand') {
        const good = s.career.trainingPerformance >= 58 && s.career.managerTrust >= 45;
        if (good) { s.career.managerTrust = clamp(s.career.managerTrust + 3, 0, 100); bumpRel(s, rel, 2); mood(s, 2); return 'He appreciated the honesty and said you would get your chance.'; }
        s.career.managerTrust = clamp(s.career.managerTrust - 7, 0, 100); bumpRel(s, rel, -7); mood(s, -3);
        return 'He did not like the tone, and pointed to what he had seen in training. That did not go well.';
      }
      return 'You said you were happy. The conversation was short.';
    },
  },
  {
    id: 'manager_criticism',
    weight: (s) => {
      const r = userPlayer(s).recentRatings.slice(-3);
      return r.length >= 3 && r.reduce((a, b) => a + b, 0) / 3 < 6.1 ? 3 : 0;
    },
    build: (s) => ({
      title: 'Manager criticises your recent form', body: `After a poor run, ${s.clubs[userPlayer(s).clubId as string]?.manager.name ?? 'the manager'} says you are not at the level he expects.`, default: 'accept', days: 4,
      options: [
        { id: 'accept', label: 'Accept it and say you will respond', detail: 'Manager +3, trust +2' },
        { id: 'private', label: 'Ask to talk in private', detail: 'Manager +4, trust +1' },
        { id: 'defend', label: 'Defend yourself to the media', detail: 'Media profile up, manager -9, trust -6' },
      ],
    }),
    resolve: (s, o) => {
      const rel = relByKind(s, 'manager');
      if (o === 'accept') { bumpRel(s, rel, 3); s.career.managerTrust = clamp(s.career.managerTrust + 2, 0, 100); mood(s, -1, -1); return 'You took it on the chin. The manager nodded.'; }
      if (o === 'private') { bumpRel(s, rel, 4); s.career.managerTrust = clamp(s.career.managerTrust + 1, 0, 100); return 'A calm conversation cleared the air.'; }
      bumpRel(s, rel, -9); s.career.managerTrust = clamp(s.career.managerTrust - 6, 0, 100); adjustRep(s, { media: 1.5, club: -3 });
      return 'Your comments made the papers. The manager was not happy.';
    },
  },
  {
    id: 'media_interview',
    weight: (s) => (s.reputation.media >= 12 ? 2 : 0.4),
    build: () => ({
      title: 'Interview request', body: 'A broadcaster wants a sit-down interview about your season.', default: 'decline', days: 6,
      options: [
        { id: 'humble', label: 'Stay humble and talk about the team', detail: 'Media +2.2, fans +1.5, club +1' },
        { id: 'bold', label: 'Talk about your big ambitions', detail: 'Media +4, club -1.5, manager -2' },
        { id: 'decline', label: 'Decline', detail: 'Media -0.8' },
      ],
    }),
    resolve: (s, o) => {
      if (o === 'humble') { adjustRep(s, { media: 2.2, fans: 1.5, club: 1, professional: 0.3 }); return 'A modest, likeable interview. Supporters liked it.'; }
      if (o === 'bold') { adjustRep(s, { media: 4, club: -1.5, fans: 0.5 }); bumpRel(s, relByKind(s, 'manager'), -2); return 'Your ambition made headlines. Not everyone at the club was thrilled.'; }
      adjustRep(s, { media: -0.8 });
      return 'You turned it down. They found someone else to talk to.';
    },
  },
  {
    id: 'charity_visit',
    weight: (s) => (ageAt(userPlayer(s).birthDay, s.day) >= 17 ? 1.4 + s.reputation.fans / 60 : 0),
    build: (s, rng) => {
      const what = rng.pick(['a children’s hospital', 'a local primary school', 'a youth club in your old neighbourhood', 'a community football day']);
      return {
        title: 'Community visit', body: `The club has been asked to send a player to ${what}.`, default: 'decline', days: 8,
        options: [
          { id: 'attend', label: 'Go along', detail: 'Fans +3, media +1, morale +3, a little tiring' },
          { id: 'shirt', label: 'Send a signed shirt', detail: 'Fans +1' },
          { id: 'decline', label: 'Decline', detail: 'Fans -0.3' },
        ],
      };
    },
    resolve: (s, o) => {
      if (o === 'attend') {
        adjustRep(s, { fans: 3, media: 1, professional: 0.5 }); mood(s, 3, 0, 4);
        const n = Number(s.flags.charityCount ?? 0) + 1;
        s.flags.charityCount = n;
        if (n >= 3) unlock(s, 'community_hero');
        return 'You spent a memorable afternoon there. The photographs were lovely.';
      }
      if (o === 'shirt') { adjustRep(s, { fans: 1 }); return 'Your signed shirt was gratefully received.'; }
      adjustRep(s, { fans: -0.3 });
      return 'You passed. Someone else went instead.';
    },
  },
  {
    id: 'fan_meet',
    weight: (s) => (s.reputation.fans >= 12 ? 1.3 : 0),
    build: () => ({
      title: 'Fans outside the training ground', body: 'A group of supporters have waited all morning to see the players leave.', default: 'wave', days: 2,
      options: [
        { id: 'sign', label: 'Stop and sign things', detail: 'Fans +2, morale +1' },
        { id: 'wave', label: 'Wave and head home', detail: 'Fans -0.3' },
      ],
    }),
    resolve: (s, o) => {
      if (o === 'sign') { adjustRep(s, { fans: 2 }); mood(s, 1); return 'You signed autographs for twenty minutes. The kids loved it.'; }
      adjustRep(s, { fans: -0.3 });
      return 'You waved and drove off.';
    },
  },
  {
    id: 'partner_meet',
    weight: (s) => {
      if (relByKind(s, 'partner')) return 0;
      if (ageAt(userPlayer(s).birthDay, s.day) < 19) return 0;
      const ended = Number(s.flags.partnerEndedDay ?? -999);
      const declined = Number(s.flags.partnerDeclinedDay ?? -999);
      return s.day - Math.max(ended, declined) > 200 ? 0.8 : 0;
    },
    build: (s, rng) => {
      const nation = userPlayer(s).nationality;
      const n = genName(rng, nation);
      return {
        title: 'Someone you would like to meet', body: `A friend introduces you to ${n.first}, who has no particular interest in football. You get on well.`, default: 'focus', days: 10, payload: { name: n.first },
        options: [
          { id: 'meet', label: 'Get to know them', detail: 'Adds a partner to your relationships. Needs time to keep going' },
          { id: 'focus', label: 'Keep your focus on football', detail: 'No change' },
        ],
      };
    },
    resolve: (s, o, d) => {
      if (o === 'meet') {
        const name = String(d.payload?.name ?? 'Alex');
        s.relationships.push({ id: 'rel_partner', name, kind: 'partner', value: 55, note: 'Someone who sees the person behind the footballer.', lastEventDay: s.day });
        mood(s, 3);
        return `You and ${name} kept in touch. Something good could come of it.`;
      }
      s.flags.partnerDeclinedDay = s.day;
      return 'You kept your head down and carried on training.';
    },
  },
  {
    id: 'partner_event',
    weight: (s) => (relByKind(s, 'partner') ? 1.8 : 0),
    build: (s) => ({
      title: `Time with ${relByKind(s, 'partner')!.name}`, body: 'Between training and matches there has not been much time lately.', default: 'focus', days: 7,
      options: [
        { id: 'weekend', label: 'Plan a weekend together', detail: `Partner +8, morale +3, fatigue down. Costs ${money(Math.min(250, s.finance.balance))}` },
        { id: 'match', label: 'Invite them to the next match', detail: 'Partner +5, morale +2' },
        { id: 'focus', label: 'Stay focused on training', detail: 'Partner -4, training impression +2' },
      ],
    }),
    resolve: (s, o) => {
      const p = relByKind(s, 'partner');
      if (o === 'weekend') { const c = Math.min(250, s.finance.balance); if (c > 0) post(s, 'purchase', 'Weekend away together', -c); bumpRel(s, p, 8); mood(s, 3, 0, -8); return 'A relaxing weekend. You both needed it.'; }
      if (o === 'match') { bumpRel(s, p, 5); mood(s, 2); return 'They watched from the stands and loved the atmosphere.'; }
      bumpRel(s, p, -4); s.career.trainingPerformance = clamp(s.career.trainingPerformance + 2, 0, 100);
      return 'You trained hard. They said they understood.';
    },
  },
];

function eventDef(id: string): LifeEventDef | undefined {
  return EVENTS.find((e) => e.id === id);
}

function pendingLife(state: GameState): PendingDecision[] {
  return state.decisions.filter((d) => d.kind === 'life' || d.kind === 'sponsor');
}

function pushDecision(state: GameState, eventId: string, kind: 'life' | 'sponsor', built: Built): PendingDecision {
  const d: PendingDecision = {
    id: uid(state, 'dec'), kind, title: built.title, body: built.body, day: state.day, expiresDay: state.day + built.days, options: built.options,
    payload: { ...(built.payload ?? {}), event: eventId, default: built.default },
  };
  state.decisions.push(d);
  return d;
}

function maybeLifeEvent(state: GameState, rng: Rng): void {
  if (state.day < state.lifeEventDay) return;
  if (pendingLife(state).length >= 2) { state.lifeEventDay = state.day + 5; return; }
  const defs = EVENTS.map((e) => ({ e, w: e.weight(state) })).filter((x) => x.w > 0);
  if (!defs.length) { state.lifeEventDay = state.day + 14; return; }
  let r = rng.next() * defs.reduce((s, x) => s + x.w, 0);
  let chosen = defs[0].e;
  for (const x of defs) { r -= x.w; if (r <= 0) { chosen = x.e; break; } }
  const built = chosen.build(state, rng);
  if (built) pushDecision(state, chosen.id, 'life', built);
  state.lifeEventDay = state.day + rng.int(16, 34);
}

function maybeSponsor(state: GameState, rng: Rng): void {
  if (state.decisions.some((d) => d.kind === 'sponsor')) return;
  if (activeSponsorships(state).length >= 3) return;
  if (ageAt(userPlayer(state).birthDay, state.day) < 16) return;
  const s = marketability(state);
  if (s < 14) return;
  if (!rng.chance(0.02 + s / 1500)) return;
  const offer = sponsorOffer(state, rng);
  if (!offer) return;
  pushDecision(state, 'sponsor', 'sponsor', {
    title: `${offer.brand} want to sponsor you`,
    body: `${offer.brand} offer a ${CATEGORY_NAME[offer.category]} sponsorship: ${money(offer.weekly)} a week for ${offer.weeks} weeks, before ${state.transfers.agent.feePct}% agent commission and 30% tax.`,
    default: 'decline', days: 14, payload: { ...offer },
    options: [
      { id: 'accept', label: 'Accept the deal', detail: `${money(offer.weekly)} a week` },
      { id: 'negotiate', label: 'Ask your agent to push for more', detail: 'A better deal, or they may walk away' },
      { id: 'decline', label: 'Decline', detail: 'No deal' },
    ],
  });
}

/** Resolve any life decision. Returns what happened. */
export function resolveLifeDecision(state: GameState, decisionId: string, optionId: string): ActionResult {
  const d = state.decisions.find((x) => x.id === decisionId);
  if (!d || (d.kind !== 'life' && d.kind !== 'sponsor')) return fail('That decision is no longer available.');
  if (!d.options.some((o) => o.id === optionId)) return fail('That is not one of the options.');
  const rng = new Rng(seedFrom(state.seed, 'decision', d.id, optionId));
  let msg: string;
  if (d.kind === 'sponsor') msg = resolveSponsor(state, d, optionId, rng);
  else {
    const def = eventDef(String(d.payload?.event));
    msg = def ? def.resolve(state, optionId, d, rng) : 'Nothing came of it.';
  }
  state.decisions = state.decisions.filter((x) => x.id !== d.id);
  const opt = d.options.find((o) => o.id === optionId);
  addNews(state, 'life', d.title, `${opt ? `${opt.label}. ` : ''}${msg}`, {});
  return ok(msg);
}

/** Decisions nobody answered resolve to their default. Called daily. */
function expireDecisions(state: GameState): void {
  for (const d of state.decisions.slice()) {
    if ((d.kind === 'life' || d.kind === 'sponsor') && d.expiresDay !== null && d.expiresDay < state.day) {
      resolveLifeDecision(state, d.id, String(d.payload?.default ?? d.options[d.options.length - 1].id));
    }
  }
}

/* ================================================================== daily and weekly processing */

function applyDailyEffects(state: GameState): void {
  const user = userPlayer(state);
  const c = user.cond;
  const comfort = housingItem(state).comfort ?? 1;
  let recovery = (comfort - 1) * 0.35;
  if (hasPurchase(state, 'svc_nutritionist')) recovery += 0.5;
  if (hasPurchase(state, 'svc_chef')) recovery += 0.4;
  if (recovery > 0) c.fatigue = clamp(c.fatigue - recovery, 0, 100);
  const bonus = lifeMoodBonus(state).total;
  if (bonus !== 0) c.morale = clamp(c.morale + bonus * 0.02, 5, 100);
  if (hasPurchase(state, 'svc_mindset') && c.confidence < 62) c.confidence = clamp(c.confidence + (62 - c.confidence) * 0.012, 5, 100);
  if (hasPurchase(state, 'svc_physio') && user.injury && user.injury.daysLeft > 1 && state.day % 5 === 0) user.injury.daysLeft -= 1;
}

/** Services you can no longer afford are dropped, the most expensive first. */
function checkOverdraft(state: GameState): void {
  const f = state.finance;
  if (f.balance >= 0) return;
  const services = f.purchases.filter((p) => catalogItem(p.catalogId)?.mode === 'service').sort((a, b) => b.upkeep - a.upkeep);
  for (const s of services) {
    if (f.balance >= 0) break;
    f.purchases = f.purchases.filter((p) => p.id !== s.id);
    addNews(state, 'life', `You can no longer afford ${s.name.toLowerCase()}`, `Your balance went below zero, so ${s.name.toLowerCase()} (${money(s.upkeep)} a week) has been cancelled.`, { important: true });
    f.balance += 0;
  }
  if (f.balance < 0) mood(state, -1);
}

function checkMilestones(state: GameState): void {
  if (state.finance.balance >= 1000000) unlock(state, 'millionaire');
  if (state.international.caps >= 10) unlock(state, 'cap_10');
  if (state.international.caps >= 50) unlock(state, 'cap_50');
  const user = userPlayer(state);
  if (ageAt(user.birthDay, state.day) >= 35 && !state.career.retired) unlock(state, 'long_career');
  if (user.clubId && (state.day - (state.career.clubSpellStart[user.clubId] ?? state.day)) / 365.25 >= 5) unlock(state, 'one_club');
}

export function processLifeWeekly(state: GameState, rng: Rng): void {
  updateReputation(state);
  driftRelationships(state);
  partnerCheck(state);
  paySponsors(state);
  reviewInvestments(state);
  checkOverdraft(state);
  maybeSponsor(state, rng);
  checkMilestones(state);
}

export function processLifeDaily(state: GameState, rng: Rng): void {
  if (state.career.retired) return;
  applyDailyEffects(state);
  expireDecisions(state);
  if (dayOfWeek(state.day) === 1) processLifeWeekly(state, rng);
  maybeLifeEvent(state, rng);
}

/* ================================================================== summaries for the UI */

export interface FinanceSummary {
  balance: number;
  careerEarnings: number;
  weeklyGross: number;
  weeklyTax: number;
  weeklyAgent: number;
  weeklyLiving: number;
  weeklySponsor: number;
  weeklyNet: number;
  last90: { income: number; spending: number; byCategory: Record<string, number> };
  netWorth: number;
  investmentValue: number;
}

export function financeSummary(state: GameState): FinanceSummary {
  const user: Player = userPlayer(state);
  const f = state.finance;
  const gross = user.contract && !user.retired ? user.contract.wage : 0;
  const tax = gross ? weeklyTax(gross) : 0;
  const agent = Math.round(gross * (state.transfers.agent.feePct / 100));
  const base = user.contract?.type === 'academy' ? 60 : 140;
  const living = base + f.purchases.reduce((s, p) => s + p.upkeep, 0);
  const spons = activeSponsorships(state).reduce((s, x) => s + x.weekly * (1 - 0.3 - state.transfers.agent.feePct / 100), 0);
  const since = state.day - 90;
  const byCategory: Record<string, number> = {};
  let income = 0;
  let spending = 0;
  for (const e of f.ledger) {
    if (e.day < since) continue;
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    if (e.amount > 0) income += e.amount; else spending -= e.amount;
  }
  const investmentValue = f.investments.filter((i) => i.status === 'active').reduce((s, i) => s + i.value, 0);
  const homeValue = f.purchases.filter((p) => catalogItem(p.catalogId)?.resale).reduce((s, p) => s + resaleValue(state, p), 0);
  return {
    balance: f.balance, careerEarnings: f.careerEarnings, weeklyGross: gross, weeklyTax: tax, weeklyAgent: agent, weeklyLiving: living,
    weeklySponsor: Math.round(spons), weeklyNet: Math.round(gross - tax - agent - living + spons), last90: { income, spending, byCategory },
    netWorth: f.balance + investmentValue + homeValue, investmentValue,
  };
}

export function relationshipLabel(v: number): string {
  if (v >= 85) return 'Very close';
  if (v >= 70) return 'Close';
  if (v >= 50) return 'Good';
  if (v >= 35) return 'Distant';
  if (v >= 20) return 'Strained';
  return 'Broken down';
}
