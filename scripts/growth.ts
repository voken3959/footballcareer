/** Growth calibration: run the user's daily development for a year and compare overall change with the target. */
import { createCareer, defaultOptions, type Pathway } from '../src/engine/career';
import { developUserDaily, growthPointsPerYear } from '../src/engine/progression';
import { overall } from '../src/engine/attributes';
import type { Position } from '../src/engine/types';

const rows: string[] = [];
for (const pos of ['ST', 'CM', 'CB', 'GK'] as Position[]) {
  for (const [pathway, age] of [['youth', 16], ['established', 16], ['custom', 19], ['custom', 22]] as [Pathway, number][]) {
    let sumD = 0;
    let sumE = 0;
    const N = 12;
    for (let s = 1; s <= N; s++) {
      const o = defaultOptions(1000 + s);
      o.position = pos;
      o.pathway = pathway;
      o.age = age;
      if (pathway === 'custom') o.custom = { ovr: 55, talent: 'great' };
      const st = createCareer(o);
      const u = st.players[st.userId];
      const start = overall(u);
      const expected = growthPointsPerYear(u, st.day);
      for (let d = 0; d < 365; d++) { st.day++; developUserDaily(st, u); }
      sumD += overall(u) - start;
      sumE += expected;
    }
    rows.push(`${pos} ${pathway} age ${age}: expected ${(sumE / N).toFixed(2)}  actual ${(sumD / N).toFixed(2)}`);
  }
}
console.log(rows.join('\n'));
