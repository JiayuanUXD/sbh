import * as migration_20260723_160143_init from './20260723_160143_init';
import * as migration_20260724_080952_add_leads_source from './20260724_080952_add_leads_source';
import * as migration_20260725_103653_m0_schema_sync from './20260725_103653_m0_schema_sync';
import * as migration_20260725_125851_m2_5_teams_brokers from './20260725_125851_m2_5_teams_brokers';
import * as migration_20260725_130727_m2_1_locations_geo_node from './20260725_130727_m2_1_locations_geo_node';
import * as migration_20260725_132852_m2_6_display_tags from './20260725_132852_m2_6_display_tags';
import * as migration_20260725_135837_m3_1_building_fields from './20260725_135837_m3_1_building_fields';
import * as migration_20260725_142333_m3_3_building_merchant_relations from './20260725_142333_m3_3_building_merchant_relations';
import * as migration_20260725_142500_m3_3_building_merchant_exclude from './20260725_142500_m3_3_building_merchant_exclude';
import * as migration_20260725_181426_m4_2_listing_merchant_relations from './20260725_181426_m4_2_listing_merchant_relations';
import * as migration_20260725_181500_m4_2_listing_merchant_exclude from './20260725_181500_m4_2_listing_merchant_exclude';
import * as migration_20260725_185329_m4_4_listing_reviews from './20260725_185329_m4_4_listing_reviews';
import * as migration_20260726_103500_m6_1_listing_reports from './20260726_103500_m6_1_listing_reports';
import * as migration_20260726_103600_m6_3_domain_events from './20260726_103600_m6_3_domain_events';

export const migrations = [
  {
    up: migration_20260723_160143_init.up,
    down: migration_20260723_160143_init.down,
    name: '20260723_160143_init',
  },
  {
    up: migration_20260724_080952_add_leads_source.up,
    down: migration_20260724_080952_add_leads_source.down,
    name: '20260724_080952_add_leads_source',
  },
  {
    up: migration_20260725_103653_m0_schema_sync.up,
    down: migration_20260725_103653_m0_schema_sync.down,
    name: '20260725_103653_m0_schema_sync',
  },
  {
    up: migration_20260725_125851_m2_5_teams_brokers.up,
    down: migration_20260725_125851_m2_5_teams_brokers.down,
    name: '20260725_125851_m2_5_teams_brokers',
  },
  {
    up: migration_20260725_130727_m2_1_locations_geo_node.up,
    down: migration_20260725_130727_m2_1_locations_geo_node.down,
    name: '20260725_130727_m2_1_locations_geo_node',
  },
  {
    up: migration_20260725_132852_m2_6_display_tags.up,
    down: migration_20260725_132852_m2_6_display_tags.down,
    name: '20260725_132852_m2_6_display_tags',
  },
  {
    up: migration_20260725_135837_m3_1_building_fields.up,
    down: migration_20260725_135837_m3_1_building_fields.down,
    name: '20260725_135837_m3_1_building_fields',
  },
  {
    up: migration_20260725_142333_m3_3_building_merchant_relations.up,
    down: migration_20260725_142333_m3_3_building_merchant_relations.down,
    name: '20260725_142333_m3_3_building_merchant_relations',
  },
  {
    up: migration_20260725_142500_m3_3_building_merchant_exclude.up,
    down: migration_20260725_142500_m3_3_building_merchant_exclude.down,
    name: '20260725_142500_m3_3_building_merchant_exclude',
  },
  {
    up: migration_20260725_181426_m4_2_listing_merchant_relations.up,
    down: migration_20260725_181426_m4_2_listing_merchant_relations.down,
    name: '20260725_181426_m4_2_listing_merchant_relations',
  },
  {
    up: migration_20260725_181500_m4_2_listing_merchant_exclude.up,
    down: migration_20260725_181500_m4_2_listing_merchant_exclude.down,
    name: '20260725_181500_m4_2_listing_merchant_exclude',
  },
  {
    up: migration_20260725_185329_m4_4_listing_reviews.up,
    down: migration_20260725_185329_m4_4_listing_reviews.down,
    name: '20260725_185329_m4_4_listing_reviews'
  },
  {
    up: migration_20260726_103500_m6_1_listing_reports.up,
    down: migration_20260726_103500_m6_1_listing_reports.down,
    name: '20260726_103500_m6_1_listing_reports',
  },
  {
    up: migration_20260726_103600_m6_3_domain_events.up,
    down: migration_20260726_103600_m6_3_domain_events.down,
    name: '20260726_103600_m6_3_domain_events',
  },
];
