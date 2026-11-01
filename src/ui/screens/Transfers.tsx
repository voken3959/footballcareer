import { useEffect, useId, useState, type ReactNode } from 'react';
import { useAct, useAsk, useDerived, useGame, useToast } from '../../store/hooks';
import { Bar, Card, Chip, Empty, Modal, PageHeader, Row, ScrollX, Stat, Tabs } from '../kit';
import { ClubTag } from '../parts';
import { clsx, formatDate, formatShort, inDaysText, money, pct } from '../format';
import { overall } from '../../engine/attributes';
import { marketValue, yearsLeft } from '../../engine/economy';
import {
  acceptOffer, agentCandidates, agentCanvass, agentRecommendations, agentWageAdvice, hireAgent, negotiateOffer, openOffers,
  packageCost, preContractClub, proposalOf, rejectOffer, requestExtension, requestLoan, requestTransfer, windowInfo,
  withdrawTransferRequest, type Proposal,
} from '../../engine/transfers';
import { userClub } from '../../engine/util';
import type { TransferOffer } from '../../engine/types';

type Tab = 'offers' | 'contract' | 'agent' | 'market';

const KIND_LABEL: Record<TransferOffer['kind'], string> = { permanent: 'Permanent transfer', loan: 'Loan', extension: 'Contract extension', free: 'Free agent signing' };

export function Transfers() {
  const g = useGame();
  const user = g.players[g.userId];
  const [tab, setTab] = useState<Tab>('offers');
  const win = windowInfo(g);
  const offers = openOffers(g);
  const bound = preContractClub(g);
  return (
    <>
      <PageHeader
        title="Transfers"
        subtitle="Offers, your contract, your agent and the market"
        actions={
          <>
            <Chip tone={win.open ? 'good' : undefined}>{win.label}{win.open && win.closesIn !== null ? ` · closes in ${win.closesIn}d` : win.opensIn !== null ? ` · opens in ${win.opensIn}d` : ''}</Chip>
            {user.loan && <Chip tone="info">On loan</Chip>}
          </>
        }
      />
      {bound && (
        <div className="mb-4 rounded-lg border border-info-400/40 bg-info-400/10 px-4 py-3 text-sm text-ink-100" role="status">
          You have agreed to join <span className="font-semibold">{bound.name}</span> when your contract ends{user.contract ? ` on ${formatDate(user.contract.endDay)}` : ''}. Until then you cannot agree another move or a new deal.
        </div>
      )}
      <Tabs<Tab> label="Transfer sections" value={tab} onChange={setTab} tabs={[
        { id: 'offers', label: 'Offers', badge: offers.length || undefined },
        { id: 'contract', label: 'Contract & requests' },
        { id: 'agent', label: 'Agent' },
        { id: 'market', label: 'Market & history' },
      ]} />
      {tab === 'offers' && <Offers />}
      {tab === 'contract' && <ContractTab />}
      {tab === 'agent' && <AgentTab />}
      {tab === 'market' && <Market />}
    </>
  );
}

/* ------------------------------------------------------------------ offers */

function Offers() {
  const g = useGame();
  const act = useAct();
  const ask = useAsk();
  const offers = openOffers(g);
  const [negotiating, setNegotiating] = useState<string | null>(null);
  const win = windowInfo(g);
  const closed = g.transfers.offers.filter((o) => o.status !== 'open' && o.status !== 'negotiating').slice(-6).reverse();

  const accept = (o: TransferOffer) => {
    const name = g.clubs[o.fromClubId]?.name ?? 'the club';
    const what = o.kind === 'extension' ? `sign a new ${o.years}-year contract at ${money(o.wage)} a week` : o.kind === 'loan' ? `join ${name} on loan` : `join ${name} on ${o.years}-year terms at ${money(o.wage)} a week`;
    ask({
      title: 'Accept this offer?',
      body: `You will ${what}. This cannot be undone.`,
      confirmLabel: 'Accept',
      onConfirm: () => act((gg) => acceptOffer(gg, o.id)),
    });
  };
  const reject = (o: TransferOffer) => {
    ask({ title: 'Turn this offer down?', body: `${g.clubs[o.fromClubId]?.name ?? 'The club'} will stop pursuing you for now.`, confirmLabel: 'Turn down', danger: true, onConfirm: () => act((gg) => rejectOffer(gg, o.id)) });
  };

  return (
    <div className="flex flex-col gap-4">
      {offers.length === 0 ? (
        <Empty
          title="No offers on the table"
          body={g.players[g.userId].clubId ? 'Clubs make offers when your form, age and potential catch their eye. Your agent can canvass clubs, and a good run of games raises your profile.' : 'Clubs will make offers as free agent interest builds. Ask your agent to canvass.'}
        />
      ) : offers.map((o) => {
        const club = g.clubs[o.fromClubId];
        const blocked = o.status === 'negotiating' || !o.sellerAgreed
          ? 'The clubs are still agreeing a fee.'
          : (o.kind === 'permanent' || o.kind === 'loan') && !win.open ? 'The transfer window is closed.' : null;
        const daysLeft = o.expiresDay - g.day;
        return (
          <section key={o.id} className="card" aria-label={`${KIND_LABEL[o.kind]} from ${club?.name}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-700 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><ClubTag club={club} size={24} bold /><Chip tone={o.kind === 'extension' ? 'info' : 'good'}>{KIND_LABEL[o.kind]}</Chip>{o.preContract && <Chip tone="info">Pre-contract</Chip>}{club && <Chip>{club.division === 1 ? 'Top division' : `Division ${club.division}`}</Chip>}</div>
                {o.reason && <p className="mt-1.5 max-w-2xl text-sm text-ink-200">{o.reason}</p>}
              </div>
              <span className={clsx('text-xs', daysLeft <= 3 ? 'font-semibold text-warn-400' : 'text-ink-300')}>{daysLeft < 0 ? 'Expired' : `Expires ${inDaysText(daysLeft)}`}</span>
            </div>
            <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
              {o.kind === 'permanent' && <Stat label="Transfer fee" value={money(o.fee)} sub={o.sellerAgreed ? 'Agreed between clubs' : 'Being negotiated'} />}
              {o.kind === 'free' && <Stat label="Fee" value="Free" />}
              <Stat label="Wage" value={`${money(o.wage)}/wk`} sub={`${money(o.wage * 52)} a year`} />
              <Stat label={o.kind === 'loan' ? 'Loan until' : 'Length'} value={o.kind === 'loan' && o.loanEndDay ? formatShort(o.loanEndDay) : `${o.years} year${o.years === 1 ? '' : 's'}`} />
              <Stat label="Role" value={o.projectedRole ?? o.role} />
              <Stat label="Signing bonus" value={o.signingBonus ? money(o.signingBonus) : '–'} />
              <Stat label="Bonuses" value={`${money(o.bonuses.appearance)} app`} sub={`${money(o.bonuses.goal)} goal${o.bonuses.cleanSheet ? ` · ${money(o.bonuses.cleanSheet)} CS` : ''}`} />
            </div>
            {(o.releaseClause || o.startDay) && (
              <p className="px-4 pb-2 text-xs text-ink-300">
                {o.releaseClause ? `Release clause ${money(o.releaseClause)}. ` : ''}{o.startDay ? `Starts ${formatDate(o.startDay)}.` : ''}
              </p>
            )}
            {o.note && <p className="px-4 pb-2 text-sm text-ink-200">{o.note}</p>}
            {o.log && o.log.length > 0 && (
              <details className="border-t border-ink-800 px-4 py-2 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-ink-300">Negotiation log ({o.log.length})</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {o.log.map((l, i) => <li key={i} className="text-xs text-ink-200"><span className="mr-2 text-ink-400">{formatShort(l.day)}</span><span className={clsx('mr-1 font-medium', l.by === 'you' ? 'text-pitch-400' : 'text-ink-100')}>{l.by === 'you' ? 'You' : l.by === 'agent' ? 'Agent' : club?.shortName ?? 'Club'}:</span>{l.text}</li>)}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-700 px-4 py-3">
              <span className="text-xs text-ink-300">{blocked ?? (o.kind !== 'loan' ? `Patience: ${o.patience} round${o.patience === 1 ? '' : 's'} of talks left` : 'Loan terms are fixed by the clubs')}</span>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-danger" onClick={() => reject(o)}>{o.kind === 'extension' ? 'Decline' : 'Turn down'}</button>
                {o.kind !== 'loan' && <button className="btn" onClick={() => setNegotiating(o.id)}>Negotiate terms</button>}
                <button className="btn btn-primary" disabled={!!blocked} title={blocked ?? undefined} onClick={() => accept(o)}>Accept</button>
              </div>
            </div>
          </section>
        );
      })}

      {closed.length > 0 && (
        <Card title="Recently closed offers" pad={false}>
          <ul className="divide-y divide-ink-800">
            {closed.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 truncate">{g.clubs[o.fromClubId]?.name} · {KIND_LABEL[o.kind]}</span>
                <Chip tone={o.status === 'accepted' ? 'good' : o.status === 'rejected' || o.status === 'withdrawn' ? 'bad' : undefined}>{o.status}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {negotiating && <NegotiateModal offerId={negotiating} onClose={() => setNegotiating(null)} />}
    </div>
  );
}

function NumField({ label, value, onChange, step = 1000, min = 0, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; hint?: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-ink-300">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-400">£</span>
        <input id={id} type="number" inputMode="numeric" className="field pl-6" min={min} step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-ink-400">{hint}</p>}
    </div>
  );
}

function NegotiateModal({ offerId, onClose }: { offerId: string; onClose: () => void }) {
  const g = useGame();
  const act = useAct();
  const o = g.transfers.offers.find((x) => x.id === offerId);
  const toast = useToast();
  const advice = useDerived((s) => agentWageAdvice(s));
  const user = g.players[g.userId];
  const value = marketValue(user, g.day);
  const [form, setForm] = useState<Proposal | null>(o ? proposalOf(o) : null);
  const [clause, setClause] = useState(!!o?.releaseClause);
  const [clauseValue, setClauseValue] = useState(o?.releaseClause ?? Math.round((value * 2.5) / 100000) * 100000);
  const [reply, setReply] = useState<{ ok: boolean; text: string } | null>(null);
  const live = !!o && (o.status === 'open' || o.status === 'negotiating');

  useEffect(() => { if (!live) onClose(); }, [live, onClose]);
  if (!o || !form) return null;

  const set = <K extends keyof Proposal>(k: K, v: Proposal[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const proposal: Proposal = { ...form, releaseClause: clause ? clauseValue : null };
  const theirs = packageCost(proposalOf(o));
  const mine = packageCost(proposal);
  const diff = theirs > 0 ? mine / theirs - 1 : 0;

  const submit = () => {
    const r = act((gg) => negotiateOffer(gg, o.id, proposal), { quiet: true });
    if (!r) return;
    setReply({ ok: r.ok, text: r.message });
    const fresh = g.transfers.offers.find((x) => x.id === o.id);
    if (fresh && (fresh.status === 'open' || fresh.status === 'negotiating')) {
      setForm(proposalOf(fresh));
      setClause(!!fresh.releaseClause);
      if (fresh.releaseClause) setClauseValue(fresh.releaseClause);
    } else {
      toast('err', r.message); // the talks ended, so the dialog closes and the toast carries the reason
    }
  };

  return (
    <Modal
      open wide onClose={onClose}
      title={`Negotiate with ${g.clubs[o.fromClubId]?.name ?? 'the club'}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={submit} disabled={o.patience <= 0}>Submit proposal</button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_16rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField label="Weekly wage" value={form.wage} onChange={(v) => set('wage', v)} step={500} hint={`They offered ${money(o.wage)}`} />
          <div>
            <label htmlFor="neg-years" className="mb-1 block text-xs text-ink-300">Contract length</label>
            <select id="neg-years" className="field" value={form.years} onChange={(e) => set('years', Number(e.target.value))}>
              {Array.from({ length: o.maxYears - o.minYears + 1 }, (_, i) => o.minYears + i).map((y) => <option key={y} value={y}>{y} year{y === 1 ? '' : 's'}</option>)}
            </select>
          </div>
          <NumField label="Signing bonus" value={form.signingBonus} onChange={(v) => set('signingBonus', v)} step={5000} />
          <NumField label="Loyalty bonus (paid at the end)" value={form.loyalty} onChange={(v) => set('loyalty', v)} step={5000} />
          <NumField label="Appearance bonus" value={form.appearance} onChange={(v) => set('appearance', v)} step={100} />
          <NumField label="Goal bonus" value={form.goal} onChange={(v) => set('goal', v)} step={100} />
          {['GK', 'CB', 'RB', 'LB', 'DM'].includes(user.position) && <NumField label="Clean-sheet bonus" value={form.cleanSheet} onChange={(v) => set('cleanSheet', v)} step={100} />}
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-100">
              <input type="checkbox" checked={clause} onChange={(e) => setClause(e.target.checked)} className="accent-emerald-500" />
              Ask for a release clause
            </label>
            {clause && <div className="mt-2 max-w-xs"><NumField label="Release clause" value={clauseValue} onChange={setClauseValue} step={100000} hint={`Clubs refuse anything under about ${money(value * 1.6)}.`} /></div>}
          </div>
          {reply && (
            <p role="status" className={clsx('rounded-md border px-3 py-2 text-sm sm:col-span-2', reply.ok ? 'border-pitch-600/50 bg-pitch-900/30 text-ink-50' : 'border-bad-500/50 bg-bad-900/20 text-ink-50')}>{reply.text}</p>
          )}
        </div>
        <aside className="flex flex-col gap-3 text-sm">
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="stat-label">Your agent’s view</div>
            <p className="mt-1 text-ink-100">A fair wage is about <span className="font-semibold">{money(advice.fair)}</span> a week ({money(advice.low)}–{money(advice.high)}).</p>
            <p className="mt-1 text-xs text-ink-300">{advice.comment}</p>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="stat-label">Your proposal vs theirs</div>
            <p className={clsx('mt-1 text-lg font-semibold', diff > 0.02 ? 'text-warn-400' : 'text-pitch-400')}>{diff > 0.001 ? '+' : ''}{pct(diff, 1)}</p>
            <p className="text-xs text-ink-300">Total package cost to the club. The higher you push, the more likely they counter or walk away.</p>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="stat-label">Patience</div>
            <p className="mt-1 text-ink-100">{o.patience} round{o.patience === 1 ? '' : 's'} left</p>
            <Bar value={o.patience} max={4} color={o.patience <= 1 ? 'bg-bad-500' : 'bg-pitch-500'} label="Club patience" className="mt-1.5" />
          </div>
        </aside>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ contract tab */

function ContractTab() {
  const g = useGame();
  const act = useAct();
  const ask = useAsk();
  const user = g.players[g.userId];
  const club = userClub(g);
  const c = user.contract;
  const requested = typeof g.flags.transferRequest === 'number';
  const parent = user.loan ? g.clubs[user.loan.parentClubId] : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Your contract">
        {!c || !club ? <Empty title="You have no contract" body="You are a free agent. Look at the offers tab or ask your agent to canvass clubs." /> : (
          <>
            <Row label="Club"><ClubTag club={club} size={16} /></Row>
            <Row label="Type">{c.type === 'academy' ? 'Academy' : 'Professional'}</Row>
            <Row label="Wage">{money(c.wage)} a week</Row>
            <Row label="Runs until">{formatDate(c.endDay)} ({yearsLeft(c, g.day).toFixed(1)} years)</Row>
            <Row label="Squad role">{g.career.squadRole}</Row>
            <Row label="Appearance / goal bonus">{money(c.bonuses.appearance)} / {money(c.bonuses.goal)}</Row>
            <Row label="Release clause">{c.releaseClause ? money(c.releaseClause) : 'None'}</Row>
            {parent && <Row label="Parent club">{parent.name} (loan ends {formatDate(user.loan!.endDay)})</Row>}
          </>
        )}
      </Card>
      <Card title="Ask the club">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-xs text-sm text-ink-200">Ask for a new contract. Clubs only discuss one when they value you and your deal is running down.</p>
            <button className="btn" onClick={() => act((gg) => requestExtension(gg))}>Ask for a new deal</button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
            <p className="max-w-xs text-sm text-ink-200">{requested ? 'You have asked to leave. Clubs find it easier to sign you, at a cost to your standing.' : 'Ask to leave. It makes a move easier but upsets the manager.'}</p>
            {requested
              ? <button className="btn" onClick={() => act((gg) => withdrawTransferRequest(gg))}>Withdraw request</button>
              : <button className="btn btn-danger" onClick={() => ask({ title: 'Ask to leave?', body: 'The manager will be unhappy and your morale takes a small hit. You can withdraw the request later.', confirmLabel: 'Hand in request', danger: true, onConfirm: () => act((gg) => requestTransfer(gg)) })}>Request transfer</button>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
            <p className="max-w-xs text-sm text-ink-200">Ask for a loan to get minutes. Only young players on the fringe are allowed, and only in a transfer window.</p>
            <button className="btn" onClick={() => act((gg) => requestLoan(gg))}>Ask for a loan</button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- agent tab */

function AgentTab() {
  const g = useGame();
  const act = useAct();
  const ask = useAsk();
  const agent = g.transfers.agent;
  const advice = useDerived((s) => agentWageAdvice(s));
  const recs = useDerived((s) => agentRecommendations(s, 6));
  const candidates = useDerived((s) => agentCandidates(s), [Math.floor(g.day / 60)]);
  const [lines, setLines] = useState<string[]>([]);
  const user = g.players[g.userId];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Card title="Where your agent would look" actions={
          <button className="btn btn-primary btn-sm" onClick={() => { const r = act((gg) => agentCanvass(gg)); setLines(r?.lines ?? []); }}>Ask {agent.name} to canvass</button>
        } pad={false}>
          <ScrollX>
            <table className="tbl">
              <thead><tr><th>Club</th><th>Division</th><th>Projected role</th><th className="num">Est. wage</th><th className="num">Interest</th></tr></thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.club.id} title={r.reason}>
                    <td><ClubTag club={r.club} size={16} /></td>
                    <td>{r.division}</td>
                    <td>{r.projectedRole}</td>
                    <td className="num">{money(r.estWage)}</td>
                    <td className={clsx('num', r.chance >= 0.6 ? 'text-pitch-400' : r.chance < 0.3 ? 'text-bad-400' : 'text-ink-100')}>{pct(r.chance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
          <p className="px-4 py-2 text-xs text-ink-400">Interest is the chance a club responds to a call. The agent’s quality and your rating of {Math.round(overall(user))} both matter.</p>
        </Card>
        {lines.length > 0 && (
          <Card title="Latest report from your agent">
            <ul className="flex flex-col gap-1 text-sm text-ink-100">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </Card>
        )}
        <Card title="Agents you could hire" pad={false}>
          <ul className="divide-y divide-ink-800">
            {candidates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-50">{c.name}</p>
                  <p className="text-xs text-ink-300">Quality {c.quality} / 20 · takes {c.cost}</p>
                </div>
                {agent.id === c.id ? <Chip tone="good">Your agent</Chip> : (
                  <button className="btn" onClick={() => ask({ title: `Hire ${c.name}?`, body: `${c.name} takes ${c.cost}. Your current agent, ${agent.name}, will be let go.`, confirmLabel: 'Hire', onConfirm: () => act((gg) => hireAgent(gg, c.id)) })}>Hire</button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title="Your agent">
          <p className="text-base font-semibold text-ink-50">{agent.name}</p>
          <div className="mt-2 flex flex-col gap-2.5">
            <div><div className="mb-1 flex justify-between text-xs"><span className="text-ink-300">Quality</span><span className="text-ink-100">{agent.quality} / 20</span></div><Bar value={agent.quality} max={20} label="Agent quality" /></div>
            <div><div className="mb-1 flex justify-between text-xs"><span className="text-ink-300">Relationship</span><span className="text-ink-100">{Math.round(agent.relationship)} / 100</span></div><Bar value={agent.relationship} label="Agent relationship" /></div>
          </div>
          <Row className="mt-2" label="Fee">{agent.feePct}% of wages</Row>
        </Card>
        <Card title="What you are worth">
          <Row label="Market value">{money(advice.value)}</Row>
          <Row label="Current wage">{advice.current ? `${money(advice.current)}/wk` : '–'}</Row>
          <Row label="Fair wage">{money(advice.fair)}/wk</Row>
          <Row label="Contract left">{advice.yearsLeft ? `${advice.yearsLeft.toFixed(1)} years` : '–'}</Row>
          <p className="mt-3 text-sm text-ink-200">{advice.comment}</p>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- market tab */

function Market() {
  const g = useGame();
  const t = g.transfers;
  const strength = (n: number) => (n >= 3 ? 'Strong' : n === 2 ? 'Genuine' : 'Faint');
  const rumours = [...t.rumours].sort((a, b) => b.day - a.day).slice(0, 8);
  const reports = [...t.scoutReports].sort((a, b) => b.day - a.day).slice(0, 8);
  const history = [...t.history].sort((a, b) => b.day - a.day).slice(0, 12);
  const moves = [...g.career.transfers].reverse();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Interest from clubs">
        {rumours.length === 0 ? <Empty title="Quiet for now" body="Clubs that are watching you show up here." /> : (
          <ul className="flex flex-col gap-2 text-sm">
            {rumours.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3"><ClubTag club={g.clubs[r.clubId]} size={16} /><span className="flex items-center gap-2 text-xs text-ink-400">{formatShort(r.day)}<Chip tone={r.strength >= 3 ? 'good' : undefined}>{strength(r.strength)}</Chip></span></li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Scout reports">
        {reports.length === 0 ? <Empty title="No scouting reports yet" /> : (
          <ul className="flex flex-col gap-2 text-sm">{reports.map((r, i) => <li key={i}><span className="mr-2 text-xs text-ink-400">{formatShort(r.day)}</span>{r.summary}</li>)}</ul>
        )}
      </Card>
      <Card title="Talks and decisions">
        {history.length === 0 ? <Empty title="Nothing yet" /> : (
          <ul className="flex flex-col gap-2 text-sm">{history.map((h, i) => <li key={i} className="flex items-start justify-between gap-3"><span><span className="mr-2 text-xs text-ink-400">{formatShort(h.day)}</span>{h.text}</span><Chip tone={h.result === 'completed' || h.result === 'accepted' ? 'good' : h.result === 'failed' || h.result === 'rejected' ? 'bad' : undefined}>{h.result}</Chip></li>)}</ul>
        )}
      </Card>
      <Card title="Career moves">
        {moves.length === 0 ? <Empty title="No moves yet" /> : (
          <ul className="flex flex-col gap-2 text-sm">
            {moves.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate"><span className="mr-2 text-xs text-ink-400">{formatShort(m.day)}</span>{m.fromClubId ? g.clubs[m.fromClubId]?.name ?? '?' : 'Free'} → {m.toClubId ? g.clubs[m.toClubId]?.name ?? '?' : m.toName ?? 'Free agent'}</span>
                <span className="shrink-0 text-xs text-ink-300">{m.kind === 'permanent' ? (m.fee ? money(m.fee) : 'Undisclosed') : m.kind.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {t.marketNews.length > 0 && (
        <Card title="Market news" className="lg:col-span-2">
          <ul className="flex flex-col gap-1.5 text-sm">{[...t.marketNews].reverse().slice(0, 10).map((n, i) => <li key={i}><span className="mr-2 text-xs text-ink-400">{formatShort(n.day)}</span>{n.text}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
