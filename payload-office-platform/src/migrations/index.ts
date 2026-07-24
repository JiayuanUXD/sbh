import * as migration_20260723_160143_init from './20260723_160143_init';
import * as migration_20260724_080952_add_leads_source from './20260724_080952_add_leads_source';

export const migrations = [
  {
    up: migration_20260723_160143_init.up,
    down: migration_20260723_160143_init.down,
    name: '20260723_160143_init',
  },
  {
    up: migration_20260724_080952_add_leads_source.up,
    down: migration_20260724_080952_add_leads_source.down,
    name: '20260724_080952_add_leads_source'
  },
];
