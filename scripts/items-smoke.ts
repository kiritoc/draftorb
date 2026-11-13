import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  championTagsMapSchema,
  itemBuildExportSchema,
  itemClassesExportSchema,
  itemsMapSchema,
  stateScaleExportSchema,
} from '../packages/shared/src/index.js';
import { recommendItems } from '../packages/engine/src/index.js';

const pub = 'data/public/16.22';
const items = itemsMapSchema.parse(JSON.parse(readFileSync(join(pub, 'items.json'), 'utf8')));
const classes = itemClassesExportSchema.parse(JSON.parse(readFileSync(join(pub, 'item-classes.json'), 'utf8')));
const tags = championTagsMapSchema.parse(JSON.parse(readFileSync('data/manual/champion-tags.json', 'utf8')));
const scale = stateScaleExportSchema.parse(JSON.parse(readFileSync(join(pub, 'state-scale.json'), 'utf8')));
const build = itemBuildExportSchema.parse(
  JSON.parse(readFileSync(join(pub, 'roles/SUPPORT/builds/412.json'), 'utf8')),
);

// Lux support, ~13 min, two completed items, even state, AP-heavy enemies.
const state = {
  time: 800,
  me: { championId: 412, kills: 2, deaths: 1, assists: 8, items: [3047, 3083] },
  allies: [{ championId: 110, kills: 5, deaths: 2, assists: 3, items: [] }],
  enemies: [
    { championId: 235, kills: 1, deaths: 4, assists: 6, items: [] },
    { championId: 104, kills: 7, deaths: 3, assists: 5, items: [3047, 3083] },
    { championId: 1, kills: 0, deaths: 1, assists: 2, items: [] },
    { championId: 3, kills: 2, deaths: 2, assists: 4, items: [] },
    { championId: 5, kills: 1, deaths: 1, assists: 3, items: [] },
  ],
  goldDiff: 800,
  kills: 2,
};

const res = recommendItems({
  state: state as never,
  myRole: 'SUPPORT',
  build,
  items,
  itemClasses: classes,
  championTags: tags,
  stateScale: scale,
  lane: {
    allies: [{ role: 'ADC', championId: 110 }],
    enemies: [
      { role: 'SUPPORT', championId: 235 },
      { role: 'ADC', championId: 104 },
    ],
  },
});
console.log('slotIdx', res.slotIdx, 'dataAvailable', res.dataAvailable);
for (const p of res.picks) {
  console.log(
    `pick ${p.itemId} ${items[String(p.itemId)]?.name ?? '?'} score=${p.score.toFixed(3)} src=${p.source} lvl=${p.contextLevel ?? '-'} nEff=${p.nEff?.toFixed(1) ?? '-'} lowData=${p.lowData}`,
  );
}
for (const p of res.avoid.slice(0, 3)) {
  console.log(`avoid ${p.itemId} ${items[String(p.itemId)]?.name ?? '?'} score=${p.score.toFixed(3)}`);
}
