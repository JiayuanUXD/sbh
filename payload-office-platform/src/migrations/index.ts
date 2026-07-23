import * as migration_20260723_160143_init from './20260723_160143_init';

export const migrations = [
  {
    up: migration_20260723_160143_init.up,
    down: migration_20260723_160143_init.down,
    name: '20260723_160143_init'
  },
];
