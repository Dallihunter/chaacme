// Ordered, run-once schema migrations.
//
// db.js still bootstraps the original schema with idempotent
// CREATE TABLE IF NOT EXISTS / ensureColumn() (that history is the baseline and
// is left alone). Every schema change from here on is a numbered migration.
import m001 from './001_edition_dates.js';
import m002 from './002_partner_panel.js';
import m003 from './003_tour_page_content.js';
import m004 from './004_site_content.js';
import m005 from './005_credentials_public.js';
import m006 from './006_absolute_image_paths.js';
import m007 from './007_booking_mode_role_label.js';

// Append only; ids strictly increasing.
export default [m001, m002, m003, m004, m005, m006, m007];
