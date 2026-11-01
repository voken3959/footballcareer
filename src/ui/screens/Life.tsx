import { useMemo, useState } from 'react';
import { useAct, useAsk, useDerived, useGame } from '../../store/hooks';
import { Bar, Card, Chip, Empty, PageHeader, Row, ScrollX, Segmented, Stat, Tabs } from '../kit';
import { clsx, formatDate, formatShort, money, pct, signed } from '../format';
import { resolveDecision } from '../../engine/game';
import {
  CATALOG, CATEGORY_LABEL, INVESTMENTS, activeSponsorships, buyItem, cancelService, catalogItem, financeSummary, housingItem, invest,
  investmentStatus, itemStatus, lifeMoodBonus, marketability, relationshipLabel, reputationLabel, resaleValue, sellInvestment, sellPurchase,
  type CatalogCategory, type CatalogItem, type InvestmentItem,
} from '../../engine/life';
import type { Investment, LedgerEntry } from '../../engine/types';

type Tab = 'overview' | 'shop' | 'owned' | 'invest' | 'money';

export function Life() {
  const g = useGame();
  const [tab, setTab] = useState<Tab>('overview');
  const pending = g.decisions.filter((d) => d.kind === 'life' || d.kind === 'sponsor').length;
  const fin = useDerived((s) => financeSummary(s));
  return (
    <>
      <PageHeader
        title="Life"
        subtitle={`Balance ${money(fin.balance)} · net worth ${money(fin.netWorth)} · ${money(fin.weeklyNet)} a week after tax and costs`}
      />
      <Tabs<Tab> label="Life sections" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview', badge: pending || undefined },
        { id: 'shop', label: 'Shop' },
        { id: 'owned', label: 'What you own' },
        { id: 'invest', label: 'Investments' },
        { id: 'money', label: 'Money' },
      ]} />
      {tab === 'overview' && <Overview />}
      {tab === 'shop' && <Shop />}
      {tab === 'owned' && <Owned />}
      {tab === 'invest' && <Investments />}
      {tab === 'money' && <Money />}
    </>
  );
}

/* ---------------------------------------------------------------- overview */

function Overview() {
  const g = useGame();
  const act = useAct();
  const decisions = g.decisions.filter((d) => d.kind === 'life' || d.kind === 'sponsor');
  const mood = useDerived((s) => lifeMoodBonus(s));
  const market = useDerived((s) => marketability(s));
  const sponsors = activeSponsorships(g);
  const rep = g.reputation;
  const repRows: { label: string; value: number }[] = [
    { label: 'Professional (peers and managers)', value: rep.professional },
    { label: 'Fans', value: rep.fans },
    { label: 'Media profile', value: rep.media },
    { label: 'Inside your club', value: rep.club },
    { label: 'National', value: rep.national },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        {decisions.length > 0 && (
          <Card title="Waiting for your answer">
            <div className="flex flex-col gap-4">
              {decisions.map((d) => (
                <div key={d.id} className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                  <p className="text-sm font-semibold text-ink-50">{d.title}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-200">{d.body}</p>
                  {d.expiresDay !== null && <p className="mt-1 text-xs text-warn-400">Answer by {formatDate(d.expiresDay)}. If you do nothing, the default applies.</p>}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {d.options.map((o) => (
                      <button key={o.id} className="btn flex-col items-start gap-0.5 py-2 text-left" onClick={() => act((gg) => resolveDecision(gg, d.id, o.id))}>
                        <span className="font-semibold">{o.label}</span>
                        {o.detail && <span className="text-xs font-normal text-ink-300">{o.detail}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
        <Card title="People in your life">
          {g.relationships.length === 0 ? <Empty title="No one yet" /> : (
            <ul className="flex flex-col gap-3">
              {g.relationships.map((r) => (
                <li key={r.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate"><span className="font-medium text-ink-50">{r.name}</span> <span className="text-xs text-ink-400">{r.kind}</span></span>
                    <span className="shrink-0 text-xs text-ink-200">{relationshipLabel(r.value)} · {Math.round(r.value)}</span>
                  </div>
                  <Bar value={r.value} color={r.value >= 70 ? 'bg-pitch-500' : r.value >= 35 ? 'bg-warn-500' : 'bg-bad-500'} label={r.name} />
                  {r.note && <p className="mt-1 text-xs text-ink-400">{r.note}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-400">Relationships fade when you ignore people. Spending time and money on them, and your choices in events, keep them strong. A personal assistant slows the fading.</p>
        </Card>
        <Card title="Sponsorships" pad={false}>
          {sponsors.length === 0 ? <div className="p-4"><Empty title="No sponsors yet" body={market < 14 ? 'Brands notice players with a profile. Perform, play in front of crowds and build your reputation.' : 'Offers arrive as decisions when brands take an interest.'} /></div> : (
            <table className="tbl">
              <thead><tr><th>Brand</th><th>Category</th><th className="num">Per week</th><th>Ends</th><th className="num">Paid</th></tr></thead>
              <tbody>{sponsors.map((s) => <tr key={s.id}><td className="font-medium text-ink-50">{s.brand}</td><td className="text-ink-300">{s.category}</td><td className="num">{money(s.weekly)}</td><td>{formatDate(s.endDay)}</td><td className="num">{money(s.paid)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title="Reputation">
          <p className="mb-3 text-sm text-ink-200">You are <span className="font-semibold text-ink-50">{reputationLabel(market).toLowerCase()}</span>. Marketability {Math.round(market)} / 100.</p>
          <ul className="flex flex-col gap-2.5">
            {repRows.map((r) => (
              <li key={r.label}>
                <div className="mb-1 flex justify-between text-xs"><span className="text-ink-300">{r.label}</span><span className="text-ink-100">{Math.round(r.value)}</span></div>
                <Bar value={r.value} label={r.label} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="How life affects your mood">
          <p className={clsx('text-lg font-semibold', mood.total >= 0 ? 'text-pitch-400' : 'text-bad-400')}>{signed(mood.total, 1)} resting morale</p>
          {mood.parts.length === 0 ? <p className="mt-1 text-sm text-ink-300">Nothing in your life is shifting your mood either way.</p> : (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {mood.parts.map((p, i) => <li key={i} className="flex justify-between"><span className="text-ink-200">{p.label}</span><span className={p.value >= 0 ? 'text-pitch-400' : 'text-bad-400'}>{signed(p.value, 1)}</span></li>)}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-400">Capped at ±6 so life never outweighs football.</p>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- shop */

const CATEGORIES = Object.keys(CATEGORY_LABEL) as CatalogCategory[];

function Shop() {
  const g = useGame();
  const act = useAct();
  const ask = useAsk();
  const [cat, setCat] = useState<CatalogCategory>('housing');
  const items = CATALOG.filter((i) => i.category === cat);
  const verb = (i: CatalogItem) => (i.mode === 'housing' ? 'Move in' : i.mode === 'service' ? 'Hire' : i.mode === 'experience' ? 'Book' : 'Buy');
  const doBuy = (i: CatalogItem) => {
    const run = () => act((gg) => buyItem(gg, i.id));
    if (i.price >= 20000 || (i.mode === 'housing' && i.price > 0)) {
      ask({ title: `${verb(i)}: ${i.name}?`, body: `${i.price ? `It costs ${money(i.price)}. ` : ''}${i.upkeep ? `Then ${money(i.upkeep)} a week.` : ''}`.trim() || 'Confirm this choice.', confirmLabel: verb(i), onConfirm: run });
    } else run();
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<CatalogCategory> label="Shop category" value={cat} onChange={setCat} options={CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c] }))} />
        <span className="text-sm text-ink-300">Balance <span className="font-semibold text-ink-50">{money(g.finance.balance)}</span></span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => {
          const st = itemStatus(g, i);
          const current = i.mode === 'housing' ? g.finance.housing === i.id : i.mode !== 'experience' && g.finance.purchases.some((p) => p.catalogId === i.id);
          return (
            <section key={i.id} className={clsx('card flex flex-col p-4', current && 'border-pitch-600/60')}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink-50">{i.name}</h3>
                {current && <Chip tone="good">{i.mode === 'housing' ? 'Your home' : i.mode === 'service' ? 'Active' : 'Owned'}</Chip>}
              </div>
              <p className="mt-1 text-xs text-ink-300">{i.blurb}</p>
              <ul className="mt-2 flex flex-col gap-0.5 text-xs text-ink-200">{i.effects.map((e, k) => <li key={k}>· {e}</li>)}</ul>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                <span className="text-sm font-semibold text-ink-50">{i.price ? money(i.price) : i.upkeep ? `${money(i.upkeep)}/wk` : 'Free'}</span>
                <button className="btn btn-primary btn-sm" disabled={!st.ok} title={st.reason} onClick={() => doBuy(i)}>{verb(i)}</button>
              </div>
              {!st.ok && st.reason && !current && <p className="mt-1.5 text-[11px] text-ink-400">{st.reason}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- owned */

function Owned() {
  const g = useGame();
  const act = useAct();
  const ask = useAsk();
  const home = housingItem(g);
  const items = g.finance.purchases.filter((p) => catalogItem(p.catalogId)?.mode !== 'housing');
  const weekly = g.finance.purchases.reduce((s, p) => s + p.upkeep, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card title="Belongings and services" pad={false}>
        {items.length === 0 ? <div className="p-4"><Empty title="You own nothing yet" body="Cars, gadgets and personal services you buy in the shop appear here." /></div> : (
          <ul className="divide-y divide-ink-800">
            {items.map((p) => {
              const it = catalogItem(p.catalogId);
              const value = resaleValue(g, p);
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink-50">{p.name}</p>
                    <p className="text-xs text-ink-300">Since {formatShort(p.day)} · {p.upkeep ? `${money(p.upkeep)} a week` : 'no running costs'}{value ? ` · worth ${money(value)}` : ''}</p>
                  </div>
                  {it?.mode === 'service' && <button className="btn btn-sm" onClick={() => ask({ title: `Cancel ${p.name}?`, body: `You will stop paying ${money(p.upkeep)} a week and lose its benefits.`, confirmLabel: 'Cancel service', danger: true, onConfirm: () => act((gg) => cancelService(gg, p.id)) })}>Cancel</button>}
                  {it?.resale && <button className="btn btn-sm" onClick={() => ask({ title: `Sell ${p.name}?`, body: `You will receive about ${money(value)}.`, confirmLabel: 'Sell', danger: true, onConfirm: () => act((gg) => sellPurchase(gg, p.id)) })}>Sell for {money(value)}</button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Home">
        <p className="text-sm font-semibold text-ink-50">{home.name}</p>
        <p className="mt-1 text-xs text-ink-300">{home.blurb}</p>
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-ink-200">{home.effects.map((e, k) => <li key={k}>· {e}</li>)}</ul>
        <Row className="mt-3" label="Weekly costs (everything)">{money(weekly)}</Row>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- investments */

function Investments() {
  const g = useGame();
  const act = useAct();
  const ask = useAsk();
  const holdings = g.finance.investments;
  const active = holdings.filter((i) => i.status === 'active');
  const past = holdings.filter((i) => i.status !== 'active');
  const totalValue = active.reduce((s, i) => s + i.value, 0);
  const totalCost = active.reduce((s, i) => s + i.cost, 0);
  const risk = (v: number) => (v >= 0.7 ? 'Very high' : v >= 0.5 ? 'High' : v >= 0.3 ? 'Medium' : 'Low');
  const buy = (i: InvestmentItem) => ask({ title: `Invest in ${i.name}?`, body: `${money(i.cost)} leaves your balance now. The value is reviewed each quarter and can rise or fall. Risk: ${risk(i.risk).toLowerCase()}.`, confirmLabel: 'Invest', onConfirm: () => act((gg) => invest(gg, i.id)) });
  const sell = (inv: Investment) => ask({ title: `Sell ${inv.name}?`, body: `It is worth ${money(inv.value)} now. Selling costs a few per cent.`, confirmLabel: 'Sell', danger: true, onConfirm: () => act((gg) => sellInvestment(gg, inv.id)) });
  return (
    <div className="flex flex-col gap-4">
      <Card title="Your portfolio">
        {active.length === 0 ? <Empty title="No investments yet" body="Property is steady, businesses are riskier and ventures can pay off hugely or fail. Nothing is guaranteed." /> : (
          <>
            <div className="mb-3 flex flex-wrap gap-6">
              <Stat label="Value now" value={money(totalValue)} />
              <Stat label="Money put in" value={money(totalCost)} />
              <Stat label="Return so far" value={pct(totalCost ? totalValue / totalCost - 1 : 0, 1)} tone={totalValue >= totalCost ? 'text-pitch-400' : 'text-bad-400'} />
            </div>
            <ScrollX>
              <table className="tbl">
                <thead><tr><th>Investment</th><th className="num">Cost</th><th className="num">Value</th><th className="num">Income</th><th>Latest</th><th /></tr></thead>
                <tbody>
                  {active.map((i) => (
                    <tr key={i.id}>
                      <td><span className="font-medium text-ink-50">{i.name}</span><span className="block text-[11px] text-ink-400">{i.type} · since {formatShort(i.startDay)}</span></td>
                      <td className="num">{money(i.cost)}</td>
                      <td className={clsx('num font-semibold', i.value >= i.cost ? 'text-pitch-400' : 'text-bad-400')}>{money(i.value)}</td>
                      <td className="num">{money(i.incomeTotal)}</td>
                      <td className="max-w-[14rem] text-xs text-ink-300">{i.history.length ? i.history[i.history.length - 1].note : 'First review pending'}</td>
                      <td className="text-right"><button className="btn btn-sm" onClick={() => sell(i)}>Sell</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          </>
        )}
      </Card>
      <Card title="Opportunities" pad={false}>
        <ul className="divide-y divide-ink-800">
          {INVESTMENTS.map((i) => {
            const st = investmentStatus(g, i);
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 max-w-xl">
                  <p className="text-sm font-medium text-ink-50">{i.name} <span className="text-xs font-normal text-ink-400">{i.type}</span></p>
                  <p className="text-xs text-ink-300">{i.blurb}</p>
                  <p className="mt-1 text-xs text-ink-400">Expected about {pct(i.expectedAnnual)} a year · risk {risk(i.risk).toLowerCase()}{i.cashShare ? ` · pays cash each quarter` : ' · no income, value only'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-ink-50">{money(i.cost)}</span>
                  <button className="btn btn-primary btn-sm" disabled={!st.ok} title={st.reason} onClick={() => buy(i)}>Invest</button>
                </div>
                {!st.ok && st.reason && <p className="w-full text-[11px] text-ink-400">{st.reason}</p>}
              </li>
            );
          })}
        </ul>
      </Card>
      {past.length > 0 && (
        <Card title="Past investments" pad={false}>
          <ul className="divide-y divide-ink-800">
            {past.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>{i.name}</span>
                <span className="flex items-center gap-2 text-xs text-ink-300">{money(i.cost)} in · {money(i.incomeTotal)} income<Chip tone={i.status === 'failed' ? 'bad' : undefined}>{i.status}</Chip></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- money */

const CAT_LABEL: Record<LedgerEntry['category'], string> = {
  wage: 'Wages', bonus: 'Bonuses', signing_bonus: 'Signing bonuses', agent_fee: 'Agent fees', tax: 'Tax', purchase: 'Purchases', living: 'Living costs',
  investment: 'Investments', investment_return: 'Investment returns', sponsorship: 'Sponsorship', transfer: 'Transfers', gift: 'Gifts', other: 'Other', loyalty: 'Loyalty payments',
};

function Money() {
  const g = useGame();
  const fin = useDerived((s) => financeSummary(s));
  const [filter, setFilter] = useState<'all' | LedgerEntry['category']>('all');
  const cats = useMemo(() => [...new Set(g.finance.ledger.map((e) => e.category))], [g.finance.ledger, g.finance.ledger.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = g.finance.ledger.filter((e) => filter === 'all' || e.category === filter).slice(-80).reverse();
  const by = Object.entries(fin.last90.byCategory).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
      <Card title="Ledger" pad={false} actions={
        <select aria-label="Filter ledger" className="field !w-auto py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All entries</option>
          {cats.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </select>
      }>
        {rows.length === 0 ? <div className="p-4"><Empty title="Nothing in the ledger yet" body="Every payment in and out of your account is recorded here." /></div> : (
          <div className="max-h-[36rem] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 bg-ink-850"><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-ink-300">{formatShort(e.day)}</td>
                    <td>{e.description}</td>
                    <td className={clsx('num whitespace-nowrap', e.amount >= 0 ? 'text-pitch-400' : 'text-ink-100')}>{e.amount >= 0 ? '+' : ''}{money(e.amount, false)}</td>
                    <td className="num whitespace-nowrap text-ink-300">{money(e.balanceAfter, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="flex flex-col gap-4">
        <Card title="Every week">
          <Row label="Gross wage">{money(fin.weeklyGross)}</Row>
          <Row label="Tax">−{money(fin.weeklyTax)}</Row>
          <Row label="Agent">−{money(fin.weeklyAgent)}</Row>
          <Row label="Living costs">−{money(fin.weeklyLiving)}</Row>
          <Row label="Sponsorship (after tax)">+{money(fin.weeklySponsor)}</Row>
          <Row label={<span className="font-semibold text-ink-100">Net</span>}><span className={fin.weeklyNet >= 0 ? 'text-pitch-400' : 'text-bad-400'}>{money(fin.weeklyNet)}</span></Row>
        </Card>
        <Card title="Last 90 days">
          <div className="mb-3 grid grid-cols-2 gap-4"><Stat label="In" value={money(fin.last90.income)} tone="text-pitch-400" /><Stat label="Out" value={money(fin.last90.spending)} /></div>
          <ul className="flex flex-col gap-1 text-sm">
            {by.map(([c, v]) => <li key={c} className="flex justify-between"><span className="text-ink-300">{CAT_LABEL[c as LedgerEntry['category']] ?? c}</span><span className={v >= 0 ? 'text-pitch-400' : 'text-ink-100'}>{v >= 0 ? '+' : ''}{money(v)}</span></li>)}
          </ul>
        </Card>
        <Card title="Totals">
          <Row label="Career earnings">{money(fin.careerEarnings)}</Row>
          <Row label="Invested">{money(fin.investmentValue)}</Row>
          <Row label="Net worth">{money(fin.netWorth)}</Row>
        </Card>
      </div>
    </div>
  );
}
