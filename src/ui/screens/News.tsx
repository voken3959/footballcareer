import { useMemo, useState, type ReactNode } from 'react';
import { useAct, useGame } from '../../store/hooks';
import { Card, Chip, Empty, PageHeader } from '../kit';
import { clsx, formatDate, plural } from '../format';
import type { NewsItem } from '../../engine/types';

type Filter = 'all' | NewsItem['type'];

const TYPE_LABEL: Record<NewsItem['type'], string> = {
  match: 'Matches', transfer: 'Transfers', rumour: 'Rumours', injury: 'Injuries', award: 'Awards', club: 'Club', league: 'League',
  international: 'International', contract: 'Contracts', milestone: 'Milestones', life: 'Life', cup: 'Cup', manager: 'Managers',
};

const PAGE = 60;

export function News() {
  const g = useGame();
  const act = useAct();
  const [filter, setFilter] = useState<Filter>('all');
  const [important, setImportant] = useState(false);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const unread = g.news.filter((n) => !n.read).length;
  const types = useMemo(() => {
    const counts = new Map<NewsItem['type'], number>();
    for (const n of g.news) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [g.news, g.news.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const list = useMemo(
    () => [...g.news].reverse().filter((n) => (filter === 'all' || n.type === filter) && (!important || n.important) && (!q || n.headline.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))),
    [g.news, g.news.length, filter, important, q], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const visible = list.slice(0, shown);

  // group by date so a busy day reads as one block
  const groups: { day: number; items: NewsItem[] }[] = [];
  for (const n of visible) {
    const last = groups[groups.length - 1];
    if (last && last.day === n.day) last.items.push(n); else groups.push({ day: n.day, items: [n] });
  }

  const markAll = () => act((gg) => { for (const n of gg.news) n.read = true; return { ok: true, message: 'All news marked as read.' }; });
  const toggle = (id: number) => act((gg) => { const n = gg.news.find((x) => x.id === id); if (n) n.read = !n.read; return { ok: true, message: '' }; }, { quiet: true });

  return (
    <>
      <PageHeader
        title="News"
        subtitle={`${plural(g.news.length, 'story', 'stories')} · ${unread ? `${unread} unread` : 'all read'}`}
        actions={<button className="btn" disabled={!unread} onClick={markAll}>Mark all as read</button>}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="news-search">Search news</label>
          <input id="news-search" type="search" className="field max-w-xs" placeholder="Search headlines" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-200">
            <input type="checkbox" className="accent-emerald-500" checked={important} onChange={(e) => { setImportant(e.target.checked); setShown(PAGE); }} />
            Important only
          </label>
        </div>
        <div role="radiogroup" aria-label="News category" className="mt-3 flex flex-wrap gap-1.5">
          <FilterChip active={filter === 'all'} onClick={() => { setFilter('all'); setShown(PAGE); }}>All</FilterChip>
          {types.map(([t, n]) => <FilterChip key={t} active={filter === t} onClick={() => { setFilter(t); setShown(PAGE); }}>{TYPE_LABEL[t]} <span className="text-ink-400">{n}</span></FilterChip>)}
        </div>
      </Card>

      {list.length === 0 ? (
        <Empty title={g.news.length === 0 ? 'No news yet' : 'Nothing matches'} body={g.news.length === 0 ? 'Stories appear as the season gets going.' : 'Try a different category or clear the search.'} />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((grp) => (
            <section key={grp.day} aria-label={formatDate(grp.day)}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">{formatDate(grp.day, true)}</h2>
              <ul className="card divide-y divide-ink-800">
                {grp.items.map((n) => (
                  <li key={n.id}>
                    <button className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-ink-800/50" onClick={() => toggle(n.id)} aria-label={`${n.headline}. ${n.read ? 'Read' : 'Unread'}. Select to toggle.`}>
                      <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-pitch-400')} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink-50">{n.headline}{n.important && <Chip tone="good">Important</Chip>}</span>
                        {n.body && <span className="mt-0.5 block text-sm text-ink-300">{n.body}</span>}
                        <span className="mt-0.5 block text-[11px] text-ink-400">{TYPE_LABEL[n.type]}{n.clubId && g.clubs[n.clubId] ? ` · ${g.clubs[n.clubId].name}` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {list.length > shown && <button className="btn mx-auto" onClick={() => setShown((s) => s + PAGE)}>Show older stories ({list.length - shown} more)</button>}
        </div>
      )}
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button role="radio" aria-checked={active} onClick={onClick} className={clsx('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', active ? 'border-pitch-500 bg-pitch-900/40 text-pitch-400' : 'border-ink-600 text-ink-200 hover:border-ink-400')}>
      {children}
    </button>
  );
}
