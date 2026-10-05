// View models for the public pages: ONE function per page type, used both by
// the JSON endpoint (GET /api/pages/<type>/<slug>) and by the server-side HTML
// renderer, so the two can never drift apart.
//
// A view model is a PUBLIC projection. It is built field by field from the
// public projections in db.js and never spreads a database row, so nothing
// internal (user ids, phone numbers, coordinates, matching fields, row ids other
// than an edition's booking id) can end up in the page or in the JSON.
import * as db from './db.js';
import { describeImage } from './images.js';
import { regionInfo } from '../deploy/assets/js/shared/regions.js';

const MAX_RELATED = 3;

const imageOrNull = (path, meta) => (path ? describeImage(path, meta) : null);

function editionView(d) {
  return {
    id: d.id,                        // the booking endpoint's tourDateId; the only non-slug id exposed
    label: d.label,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    capacity: d.capacity,
    available: d.available,          // seats left (0 when full or past)
    full: d.disabled,                // not bookable (full, closed)
    status: d.status
  };
}

function personView(h) {
  return {
    slug: h.slug,
    name: h.displayName,
    role: h.role,
    verified: !!h.verified,
    expertise: h.expertise || null,
    photo: imageOrNull(h.photoPath, { alt: h.displayName })
  };
}

function venueView(h) {
  return {
    slug: h.slug,
    name: h.displayName,
    verified: !!h.verified,
    region: h.region || null,        // free-text locality, e.g. "سه‌هزار، تنکابن"
    lodgingType: h.lodgingType || null,
    amenities: Array.isArray(h.amenities) ? h.amenities : [],
    photo: imageOrNull(h.photoPath, { alt: h.displayName })
  };
}

/** Everything the experience card needs, for the related-tours row. */
function cardView(row) {
  const hosts = db.tourHostsPublic(row.id);
  const lead = hosts.find((h) => h.role === 'lead') || hosts.find((h) => h.role !== 'venue') || null;
  const venue = hosts.find((h) => h.role === 'venue') || null;
  const next = db.tourDates(row.id).find((d) => !d.disabled) || null;
  return {
    slug: row.id,
    name: row.name,
    region: regionInfo(row.region),
    comingSoon: row.status === 'coming_soon',
    cover: imageOrNull(row.cover_path || row.photo_path, { alt: row.name }),
    leadName: lead ? lead.displayName : null,
    venueName: venue ? venue.displayName : null,
    nextEdition: next ? { label: next.label, startsOn: next.startsOn, endsOn: next.endsOn } : null,
    price: row.price ?? null
  };
}

/** GET /api/pages/tour/:slug — null when the tour does not exist or is not public. */
export function buildTourPage(slug) {
  const t = db.getTourDetail(slug);
  if (!t) return null;

  const gallery = t.galleryMedia
    .filter((m) => m.photoPath)
    .map((m) => describeImage(m.photoPath, { alt: m.alt, caption: m.caption }))
    .filter(Boolean);
  const cover = gallery[0] || imageOrNull(t.photoPath, { alt: t.name });

  const highlights = t.highlights.map((h) => ({
    name: h.name,
    description: h.description || null,
    image: imageOrNull(h.image, { alt: h.imageAlt, caption: h.imageCaption })
  }));

  const itinerary = t.itinerary.map((it) => {
    // Old rows keep their photos in photoPath / photos; new rows in images (with alt + caption).
    const images = it.images.length
      ? it.images.map((i) => imageOrNull(i && i.path, { alt: i && i.alt, caption: i && i.caption }))
      : [it.photoPath, ...it.photos].map((p) => imageOrNull(p, {}));
    return {
      label: it.time || null,
      title: it.title,
      description: it.description || null,
      images: images.filter(Boolean).slice(0, 6)
    };
  });

  const venueHost = t.hosts.find((h) => h.role === 'venue' && h.kind === 'place') || null;
  const people = t.hosts.filter((h) => h.role !== 'venue' && h.kind === 'person');
  people.sort((a, b) => (a.role === 'lead' ? 0 : 1) - (b.role === 'lead' ? 0 : 1));

  const editions = t.status === 'published'
    ? t.bookingDates.filter((d) => !d.past).map(editionView)
    : [];

  const reviews = t.reviews.map((r) => ({
    displayName: r.displayName,
    rating: r.rating,
    body: r.body,
    createdAt: String(r.createdAt || '').slice(0, 10)
  }));

  return {
    slug: t.id,
    name: t.name,
    comingSoon: t.status === 'coming_soon',
    region: regionInfo(t.region),
    experienceType: t.experienceType || null,
    level: t.level || null,
    duration: t.duration || null,
    story: t.story || null,
    included: t.included || null,
    bringList: t.bringList || null,
    description: t.description || null,   // meta-description fallback only; the page shows `story`
    seoDescription: t.seoDescription || null,
    price: t.price ?? null,
    cover,
    gallery,
    highlights,
    itinerary,
    venue: venueHost ? venueView(venueHost) : null,
    people: people.map(personView),
    editions,
    reviews: { count: t.reviewSummary.count, average: t.reviewSummary.average, items: reviews },
    related: db.listRelatedTours(t.id, t.region, MAX_RELATED).map(cardView)
  };
}
