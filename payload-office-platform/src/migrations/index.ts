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
import * as migration_20260726_103700_m6_4_tasks from './20260726_103700_m6_4_tasks';
import * as migration_20260726_103800_m6_7_notifications from './20260726_103800_m6_7_notifications';
import * as migration_20260726_110000_m5_1_crm_collections from './20260726_110000_m5_1_crm_collections';
import * as migration_20260726_140000_m5_2_leads_inquiry_context from './20260726_140000_m5_2_leads_inquiry_context';
import * as migration_20260726_150000_opt017_inquiry_rate_limit from './20260726_150000_opt017_inquiry_rate_limit';
import * as migration_20260728_175500_locked_docs_audit_logs_rel from './20260728_175500_locked_docs_audit_logs_rel';
import * as migration_20260728_180000_opt_021_admin_navigation_roles from './20260728_180000_opt_021_admin_navigation_roles';
import * as migration_20260728_181000_opt_021_form_submission_status from './20260728_181000_opt_021_form_submission_status';
import * as migration_20260730_125851_detail_page_fields from './20260730_125851_detail_page_fields';
import * as migration_20260730_134600_inquiry_detail_context from './20260730_134600_inquiry_detail_context';
import * as migration_20260731_110500_fix_tasks_notifications_relationship from './20260731_110500_fix_tasks_notifications_relationship';
import * as migration_20260731_120000_information_corrections from './20260731_120000_information_corrections';
import * as migration_20260731_120838_advisor_service_hours from './20260731_120838_advisor_service_hours';
import * as migration_20260731_120857_lead_viewing_preference from './20260731_120857_lead_viewing_preference';
import * as migration_20260803_104120_add_articles from './20260803_104120_add_articles';
import * as migration_20260805_033418_cos_media_prefix from './20260805_033418_cos_media_prefix';
import * as migration_20260806_080629_locations_cover_image from './20260806_080629_locations_cover_image';
import * as migration_20260808_224000_articles_menu_for_ops from './20260808_224000_articles_menu_for_ops';
import * as migration_20260809_142444_supply_submissions_and_entrust_source from './20260809_142444_supply_submissions_and_entrust_source';
import * as migration_20260809_180000_supply_notification_duplicates_preflight from './20260809_180000_supply_notification_duplicates_preflight';
import * as migration_20260809_183327_supply_submission_notification_unique from './20260809_183327_supply_submission_notification_unique';
import * as migration_20260809_203911_supply_submission_notification_jobs from './20260809_203911_supply_submission_notification_jobs';
import * as migration_20260810_003111_align_listings_data_source_with_production from './20260810_003111_align_listings_data_source_with_production';
import * as migration_20260810_090000_supply_submission_role_permissions from './20260810_090000_supply_submission_role_permissions';
import * as migration_20260810_114857_locations_city_field from './20260810_114857_locations_city_field';
import * as migration_20260810_153500_landing_hero_media_assets from './20260810_153500_landing_hero_media_assets';
import * as migration_20260810_170000_public_page_performance_indexes from './20260810_170000_public_page_performance_indexes';
import * as migration_20260810_200000_backfill_location_city from './20260810_200000_backfill_location_city';
import * as migration_20260813_010000_city_site_profiles from './20260813_010000_city_site_profiles';
import * as migration_20260813_011000_seed_city_site_profiles from './20260813_011000_seed_city_site_profiles';
import * as migration_20260813_020000_city_partner_applications from './20260813_020000_city_partner_applications';
import * as migration_20260813_021000_city_partner_permissions from './20260813_021000_city_partner_permissions';
import * as migration_20260813_022000_city_partner_notification_jobs from './20260813_022000_city_partner_notification_jobs';
import * as migration_20260813_060037_city_partner_notification_outbox_reconciler from './20260813_060037_city_partner_notification_outbox_reconciler';
import * as migration_20260815_140000_converge_shanghai_city_code from './20260815_140000_converge_shanghai_city_code';
import * as migration_20260817_172754_sale_price_one_time from './20260817_172754_sale_price_one_time';
import * as migration_20260817_174500_sale_business_type_index from './20260817_174500_sale_business_type_index';
import * as migration_20260817_175801_sale_terms_fields from './20260817_175801_sale_terms_fields';
import * as migration_20260817_180000_sale_publication_status_sold from './20260817_180000_sale_publication_status_sold';
import * as migration_20260818_072207_fast_track_review_decision from './20260818_072207_fast_track_review_decision';

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
    name: '20260725_185329_m4_4_listing_reviews',
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
  {
    up: migration_20260726_103700_m6_4_tasks.up,
    down: migration_20260726_103700_m6_4_tasks.down,
    name: '20260726_103700_m6_4_tasks',
  },
  {
    up: migration_20260726_103800_m6_7_notifications.up,
    down: migration_20260726_103800_m6_7_notifications.down,
    name: '20260726_103800_m6_7_notifications',
  },
  {
    up: migration_20260726_110000_m5_1_crm_collections.up,
    down: migration_20260726_110000_m5_1_crm_collections.down,
    name: '20260726_110000_m5_1_crm_collections',
  },
  {
    up: migration_20260726_140000_m5_2_leads_inquiry_context.up,
    down: migration_20260726_140000_m5_2_leads_inquiry_context.down,
    name: '20260726_140000_m5_2_leads_inquiry_context',
  },
  {
    up: migration_20260726_150000_opt017_inquiry_rate_limit.up,
    down: migration_20260726_150000_opt017_inquiry_rate_limit.down,
    name: '20260726_150000_opt017_inquiry_rate_limit',
  },
  {
    up: migration_20260728_175500_locked_docs_audit_logs_rel.up,
    down: migration_20260728_175500_locked_docs_audit_logs_rel.down,
    name: '20260728_175500_locked_docs_audit_logs_rel',
  },
  {
    up: migration_20260728_180000_opt_021_admin_navigation_roles.up,
    down: migration_20260728_180000_opt_021_admin_navigation_roles.down,
    name: '20260728_180000_opt_021_admin_navigation_roles',
  },
  {
    up: migration_20260728_181000_opt_021_form_submission_status.up,
    down: migration_20260728_181000_opt_021_form_submission_status.down,
    name: '20260728_181000_opt_021_form_submission_status',
  },
  {
    up: migration_20260730_125851_detail_page_fields.up,
    down: migration_20260730_125851_detail_page_fields.down,
    name: '20260730_125851_detail_page_fields',
  },
  {
    up: migration_20260730_134600_inquiry_detail_context.up,
    down: migration_20260730_134600_inquiry_detail_context.down,
    name: '20260730_134600_inquiry_detail_context',
  },
  {
    up: migration_20260731_110500_fix_tasks_notifications_relationship.up,
    down: migration_20260731_110500_fix_tasks_notifications_relationship.down,
    name: '20260731_110500_fix_tasks_notifications_relationship',
  },
  {
    up: migration_20260731_120000_information_corrections.up,
    down: migration_20260731_120000_information_corrections.down,
    name: '20260731_120000_information_corrections',
  },
  {
    up: migration_20260731_120838_advisor_service_hours.up,
    down: migration_20260731_120838_advisor_service_hours.down,
    name: '20260731_120838_advisor_service_hours',
  },
  {
    up: migration_20260731_120857_lead_viewing_preference.up,
    down: migration_20260731_120857_lead_viewing_preference.down,
    name: '20260731_120857_lead_viewing_preference',
  },
  {
    up: migration_20260803_104120_add_articles.up,
    down: migration_20260803_104120_add_articles.down,
    name: '20260803_104120_add_articles',
  },
  {
    up: migration_20260805_033418_cos_media_prefix.up,
    down: migration_20260805_033418_cos_media_prefix.down,
    name: '20260805_033418_cos_media_prefix',
  },
  {
    up: migration_20260806_080629_locations_cover_image.up,
    down: migration_20260806_080629_locations_cover_image.down,
    name: '20260806_080629_locations_cover_image',
  },
  {
    up: migration_20260808_224000_articles_menu_for_ops.up,
    down: migration_20260808_224000_articles_menu_for_ops.down,
    name: '20260808_224000_articles_menu_for_ops',
  },
  {
    up: migration_20260809_142444_supply_submissions_and_entrust_source.up,
    down: migration_20260809_142444_supply_submissions_and_entrust_source.down,
    name: '20260809_142444_supply_submissions_and_entrust_source',
  },
  {
    up: migration_20260809_180000_supply_notification_duplicates_preflight.up,
    down: migration_20260809_180000_supply_notification_duplicates_preflight.down,
    name: '20260809_180000_supply_notification_duplicates_preflight',
  },
  {
    up: migration_20260809_183327_supply_submission_notification_unique.up,
    down: migration_20260809_183327_supply_submission_notification_unique.down,
    name: '20260809_183327_supply_submission_notification_unique',
  },
  {
    up: migration_20260809_203911_supply_submission_notification_jobs.up,
    down: migration_20260809_203911_supply_submission_notification_jobs.down,
    name: '20260809_203911_supply_submission_notification_jobs',
  },
  {
    up: migration_20260810_003111_align_listings_data_source_with_production.up,
    down: migration_20260810_003111_align_listings_data_source_with_production.down,
    name: '20260810_003111_align_listings_data_source_with_production',
  },
  {
    up: migration_20260810_090000_supply_submission_role_permissions.up,
    down: migration_20260810_090000_supply_submission_role_permissions.down,
    name: '20260810_090000_supply_submission_role_permissions',
  },
  {
    up: migration_20260810_114857_locations_city_field.up,
    down: migration_20260810_114857_locations_city_field.down,
    name: '20260810_114857_locations_city_field',
  },
  {
    up: migration_20260810_153500_landing_hero_media_assets.up,
    down: migration_20260810_153500_landing_hero_media_assets.down,
    name: '20260810_153500_landing_hero_media_assets',
  },
  {
    up: migration_20260810_170000_public_page_performance_indexes.up,
    down: migration_20260810_170000_public_page_performance_indexes.down,
    name: '20260810_170000_public_page_performance_indexes',
  },
  {
    up: migration_20260810_200000_backfill_location_city.up,
    down: migration_20260810_200000_backfill_location_city.down,
    name: '20260810_200000_backfill_location_city',
  },
  {
    up: migration_20260813_010000_city_site_profiles.up,
    down: migration_20260813_010000_city_site_profiles.down,
    name: '20260813_010000_city_site_profiles',
  },
  {
    up: migration_20260813_011000_seed_city_site_profiles.up,
    down: migration_20260813_011000_seed_city_site_profiles.down,
    name: '20260813_011000_seed_city_site_profiles',
  },
  {
    up: migration_20260813_020000_city_partner_applications.up,
    down: migration_20260813_020000_city_partner_applications.down,
    name: '20260813_020000_city_partner_applications',
  },
  {
    up: migration_20260813_021000_city_partner_permissions.up,
    down: migration_20260813_021000_city_partner_permissions.down,
    name: '20260813_021000_city_partner_permissions',
  },
  {
    up: migration_20260813_022000_city_partner_notification_jobs.up,
    down: migration_20260813_022000_city_partner_notification_jobs.down,
    name: '20260813_022000_city_partner_notification_jobs',
  },
  {
    up: migration_20260813_060037_city_partner_notification_outbox_reconciler.up,
    down: migration_20260813_060037_city_partner_notification_outbox_reconciler.down,
    name: '20260813_060037_city_partner_notification_outbox_reconciler',
  },
  {
    up: migration_20260815_140000_converge_shanghai_city_code.up,
    down: migration_20260815_140000_converge_shanghai_city_code.down,
    name: '20260815_140000_converge_shanghai_city_code',
  },
  {
    up: migration_20260817_172754_sale_price_one_time.up,
    down: migration_20260817_172754_sale_price_one_time.down,
    name: '20260817_172754_sale_price_one_time',
  },
  {
    up: migration_20260817_174500_sale_business_type_index.up,
    down: migration_20260817_174500_sale_business_type_index.down,
    name: '20260817_174500_sale_business_type_index',
  },
  {
    up: migration_20260817_175801_sale_terms_fields.up,
    down: migration_20260817_175801_sale_terms_fields.down,
    name: '20260817_175801_sale_terms_fields',
  },
  {
    up: migration_20260817_180000_sale_publication_status_sold.up,
    down: migration_20260817_180000_sale_publication_status_sold.down,
    name: '20260817_180000_sale_publication_status_sold',
  },
  {
    up: migration_20260818_072207_fast_track_review_decision.up,
    down: migration_20260818_072207_fast_track_review_decision.down,
    name: '20260818_072207_fast_track_review_decision'
  },
];
