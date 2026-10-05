import { hasColumn } from '../migrate.js';

// Content the redesigned public tour page reads. Additive only: every new
// column is nullable and existing rows keep NULL, so every block that depends on
// one stays hidden until an admin fills it in. Nothing is backfilled.
//
//   tours.story            long-form "story of this experience" (<= 1500)
//   tours.region           desert | forest | sea (validated in the app, see
//                          deploy/assets/js/shared/regions.js, so adding a region needs no migration)
//   tours.experience_type  short label, e.g. "ریتریت حرکتی" (<= 60)
//   tours.level            short label, e.g. "مناسب همهٔ سطوح" (<= 60)
//   tours.bring_list       what to bring (<= 600)
//   tours.seo_description  meta description override (<= 160)
//   (the "what is included" copy already exists as tours.included)
//
//   tour_media.alt/caption          alt text (<= 160) and caption (<= 120) per gallery image
//   tour_highlights.image_path/_alt/_caption   optional image per highlight
//   tour_itinerary.images           JSON array, 0-6 of {path, alt, caption} per day. Inline JSON like
//                                   tour_itinerary.photos: the itinerary is a replace-all list with no stable row ids.
//
// Gallery order is tour_media.ordinal (already explicit); the first row is the cover.
export default {
  id: 3,
  name: 'tour_page_content',
  up(db) {
    const add = (table, column, ddl) => {
      if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };
    add('tours', 'story', 'story TEXT');
    add('tours', 'region', 'region TEXT');
    add('tours', 'experience_type', 'experience_type TEXT');
    add('tours', 'level', 'level TEXT');
    add('tours', 'bring_list', 'bring_list TEXT');
    add('tours', 'seo_description', 'seo_description TEXT');
    add('tour_media', 'alt', 'alt TEXT');
    add('tour_media', 'caption', 'caption TEXT');
    add('tour_highlights', 'image_path', 'image_path TEXT');
    add('tour_highlights', 'image_alt', 'image_alt TEXT');
    add('tour_highlights', 'image_caption', 'image_caption TEXT');
    add('tour_itinerary', 'images', 'images TEXT');
  }
};
