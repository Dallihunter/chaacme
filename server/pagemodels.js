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
import { regionInfo, REGION_KEYS } from '../deploy/assets/js/shared/regions.js';
import { jalaliMonthKey, jalaliMonthLabel } from '../deploy/assets/js/shared/format.js';
import { getSettings, infoParagraphs, contactDetails } from './settings.js';
import { effectiveBooking } from './booking.js';
import { INFO_PAGES } from '../deploy/assets/js/shared/site.js';

const MAX_RELATED = 3;

const imageOrNull = (path, meta) => (path ? describeImage(path, meta) : null);

/**
 * One edition for the page. `seatsReal` is true only when the site itself takes the bookings (effective mode
 * 'online'): only then are capacity, seats left and the booking id meaningful. In every other mode the platform
 * has no booking data (reservations happen elsewhere), so no seat count, capacity or availability wording is passed
 * on, and `full` means only what the admin did: the edition was closed.
 */
function editionView(d, seatsReal) {
  return {
    id: seatsReal ? d.id : null,     // the booking endpoint's tourDateId; the only non-slug id exposed
    label: d.label,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    capacity: seatsReal ? d.capacity : null,
    available: seatsReal ? d.available : null,   // seats left (0 when full or past)
    full: seatsReal ? d.disabled : d.closed,     // «تکمیل»: not bookable (online) / closed by the admin (otherwise)
    status: seatsReal ? d.status : null
  };
}

function personView(h) {
  return {
    slug: h.slug,
    name: h.displayName,
    role: h.role,
    roleLabel: h.roleLabel || null,  // what this card says instead of the default role word, set per tour link
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

/**
 * The picture on a card: the explicit cover (tours.photo_path, «عکس کاور») when there is one, otherwise the first gallery
 * photo. A value that does not describe to an image (a path that is not /images/<dir>/<file>) is skipped, so the frame
 * stays empty only when the tour has no usable image at all.
 */
function cardCover(row) {
  for (const path of [row.photo_path, ...db.tourGalleryPaths(row.id)]) {
    const image = imageOrNull(path, { alt: row.name });
    if (image) return image;
  }
  return null;
}

/**
 * Everything an experience card needs (home, experiences, a profile's experiences, related row).
 * `editions` lists the upcoming dated editions with their openness: the experiences filters read it.
 */
export function cardView(row) {
  const hosts = db.tourHostsPublic(row.id);
  const lead = hosts.find((h) => h.role === 'lead') || hosts.find((h) => h.role !== 'venue') || null;
  const venue = hosts.find((h) => h.role === 'venue') || null;
  const dates = row.status === 'published' ? db.tourDates(row.id).filter((d) => !d.past) : [];
  // Seats only mean something when the site takes the bookings itself; otherwise "open" is just "not closed".
  const seatsReal = effectiveBooking(row).effective === 'online';
  const isOpen = (d) => (seatsReal ? !d.disabled : !d.closed);
  // The first open edition; with none open, the first dated one (shown with «تکمیل»), so a future date is never hidden.
  const next = dates.find(isOpen) || dates.find((d) => d.startsOn) || null;
  return {
    slug: row.id,
    name: row.name,
    region: regionInfo(row.region),
    comingSoon: row.status === 'coming_soon',
    cover: cardCover(row),
    leadName: lead ? lead.displayName : null,
    venueName: venue ? venue.displayName : null,
    nextEdition: next
      ? { label: next.label, startsOn: next.startsOn, endsOn: next.endsOn, available: seatsReal ? next.available : null, full: !isOpen(next) }
      : null,
    price: row.price ?? null,
    duration: row.duration || null,
    experienceType: row.experience_type || null,
    editions: dates.filter((d) => d.startsOn).map((d) => ({ startsOn: d.startsOn, open: isOpen(d) }))
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

  // An edition with no ISO date that cannot be booked (closed, full) tells a visitor nothing but a bare label of a
  // date that is not coming. It is left out, so a tour whose only editions are those reads «تاریخ بعدی اعلام می‌شود».
  // Dated editions are always listed (a full one as «تکمیل»); an open one is listed even before it has a date.
  const eb = effectiveBooking(db.getTourBookingRow(t.id));
  const seatsReal = eb.effective === 'online';
  const editions = t.status === 'published'
    ? t.bookingDates.filter((d) => !d.past && (d.startsOn || !(seatsReal ? d.disabled : d.closed))).map((d) => editionView(d, seatsReal))
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
    // How this tour is reserved right now (server/booking.js): `effective` is what the page does, `link` the
    // validated button of an 'external' tour, `soon` an online tour while the site-wide switch is off.
    booking: {
      mode: eb.mode,
      effective: eb.effective,
      soon: eb.soon,
      link: eb.link ? { href: eb.link.href, newTab: eb.link.newTab, label: eb.label } : null,
      note: eb.note
    },
    editions,
    reviews: { count: t.reviewSummary.count, average: t.reviewSummary.average, items: reviews },
    related: db.listRelatedTours(t.id, t.region, MAX_RELATED).map(cardView)
  };
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------
const MAX_HOME_TOURS = 6;
const MAX_HOME_PLACES = 4;

/** A card for a place profile (home, /places): name, line under it, photo. */
export function placeCardView(h) {
  return {
    slug: h.slug,
    name: h.display_name,
    verified: !!h.verified_at,
    lodgingType: h.lodging_type || null,
    region: h.region || null,
    regionTone: regionInfo(h.region_key),
    photo: imageOrNull(h.photo_path, { alt: h.display_name })
  };
}

const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** GET /api/pages/home */
export function buildHomePage() {
  const st = getSettings();
  const published = db.listTourCardRows().filter((r) => r.status === 'published').map(cardView);
  const upcoming = published
    .filter((c) => c.nextEdition && c.nextEdition.startsOn && !c.nextEdition.full)
    .sort((a, b) => a.nextEdition.startsOn.localeCompare(b.nextEdition.startsOn))
    .slice(0, MAX_HOME_TOURS);
  // No open dated edition anywhere: the published experiences in catalogue order, with the date left open (an
  // undated label such as «۲۶ مهر» is not a date, so none is passed on). The home shows `upcoming` when it has any.
  const experiences = upcoming.length ? [] : published.slice(0, MAX_HOME_TOURS).map((c) => ({ ...c, nextEdition: null, editions: [] }));

  const cards = [1, 2, 3].map((n) => ({
    title: textOrNull(st[`explainer_${n}_title`]),
    text: textOrNull(st[`explainer_${n}_text`]),
    image: imageOrNull(st[`explainer_${n}_image`], { alt: '' })
  })).filter((c) => c.title || c.text || c.image);
  const explainer = st.explainer_title || st.explainer_text || cards.length
    ? { title: textOrNull(st.explainer_title), text: textOrNull(st.explainer_text), cards }
    : null;

  const hero = {
    video: textOrNull(st.home_hero_video),
    poster: imageOrNull(st.home_hero_poster || st.home_hero_image, { alt: '' }),
    image: imageOrNull(st.home_hero_image || st.home_hero_poster, { alt: '' }),
    headline: textOrNull(st.home_hero_headline),
    subline: textOrNull(st.home_hero_subline),
    ctaPrimary: textOrNull(st.home_cta_primary),
    ctaSecondary: textOrNull(st.home_cta_secondary)
  };
  const hasHero = !!(hero.video || hero.poster || hero.image || hero.headline);

  return {
    hero: hasHero ? hero : null,
    upcoming,
    experiences,
    explainer,
    places: db.listActivePlaces(MAX_HOME_PLACES).map(placeCardView),
    hostBand: st.become_host_title || st.become_host_text
      ? { title: textOrNull(st.become_host_title), text: textOrNull(st.become_host_text), cta: textOrNull(st.become_host_cta) }
      : null
  };
}

// ---------------------------------------------------------------------------------------------
// Experiences listing (filters come from the query string, validated against what exists)
// ---------------------------------------------------------------------------------------------
const MONTH_PARAM = /^\d{4}-\d{2}$/;

/**
 * GET /api/pages/experiences?region=&type=&month=&open=1
 * Filtering is done in memory over the loaded cards: no query text is ever built from the input,
 * and a value that is not one of the options (an unknown region, a month nobody runs) is ignored.
 */
export function buildExperiencesPage(params = new URLSearchParams()) {
  const cards = db.listTourCardRows().map(cardView);

  // options come from what exists, so a visitor can never pick a filter that has no results by construction
  const regions = REGION_KEYS.filter((k) => cards.some((c) => c.region && c.region.key === k)).map((k) => regionInfo(k));
  const types = [...new Set(cards.map((c) => c.experienceType).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
  const monthLabels = new Map();
  for (const c of cards) for (const e of c.editions) {
    const key = jalaliMonthKey(e.startsOn);
    if (key && !monthLabels.has(key)) monthLabels.set(key, jalaliMonthLabel(e.startsOn));
  }
  const months = [...monthLabels.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, label]) => ({ key, label }));
  const hasEditions = cards.some((c) => c.editions.length);

  const pick = (name) => { const v = params.get(name); return typeof v === 'string' ? v : ''; };
  const region = regions.some((r) => r.key === pick('region')) ? pick('region') : null;
  const type = types.includes(pick('type')) ? pick('type') : null;
  const month = MONTH_PARAM.test(pick('month')) && monthLabels.has(pick('month')) ? pick('month') : null;
  const openOnly = pick('open') === '1' && hasEditions;

  const shown = cards.filter((c) => {
    if (region && !(c.region && c.region.key === region)) return false;
    if (type && c.experienceType !== type) return false;
    const eds = c.editions.filter((e) => !openOnly || e.open);
    if (openOnly && !eds.length) return false;
    if (month && !eds.some((e) => jalaliMonthKey(e.startsOn) === month)) return false;
    return true;
  });
  const openEditions = shown.reduce((n, c) => n + c.editions.filter((e) => e.open).length, 0);

  return {
    filters: { region, type, month, open: openOnly },
    options: { regions, types, months, canFilterOpen: hasEditions },
    active: !!(region || type || month || openOnly),
    total: cards.length,
    count: shown.length,
    openEditions,
    cards: shown
  };
}

/** GET /api/pages/places */
export function buildPlacesPage() {
  return { places: db.listActivePlaces().map(placeCardView) };
}

// ---------------------------------------------------------------------------------------------
// Info pages (/about /terms /refund /privacy): null (-> 404) while the body is empty
// ---------------------------------------------------------------------------------------------
export function buildInfoPage(key) {
  const def = INFO_PAGES.find((p) => p.key === key);
  if (!def) return null;
  const st = getSettings();
  if (def.key === 'contact') {
    const contact = contactDetails(st);
    return contact ? { key: def.key, path: def.path, title: def.label, paragraphs: [], contact } : null;
  }
  const paragraphs = infoParagraphs(st[def.setting]);
  return paragraphs.length ? { key: def.key, path: def.path, title: def.label, paragraphs } : null;
}

// ---------------------------------------------------------------------------------------------
// Place / person profile (/host/<slug>)
// ---------------------------------------------------------------------------------------------
/** GET /api/pages/host/:slug — public projection, built field by field. */
export function buildHostPage(slug) {
  const h = db.getHostForPage(slug);
  if (!h) return null;
  const isPlace = h.kind === 'place';
  const name = h.displayName;

  const gallery = h.gallery
    .map((m) => describeImage(m.photoPath, { alt: m.alt || m.caption || name, caption: m.caption || null }))
    .filter(Boolean);
  const experiences = db.listTourCardRows({ hostId: h.id }).map(cardView);

  const base = {
    slug: h.slug,
    kind: isPlace ? 'place' : 'person',
    name,
    verified: !!h.verified,
    bio: h.bio || null,
    instagram: h.instagramHandle || null,
    photo: imageOrNull(h.photoPath, { alt: name }),
    gallery,
    experiences,
    reviews: {
      count: h.reviewSummary.count,
      average: h.reviewSummary.average,
      items: h.reviews.map((r) => ({
        displayName: r.displayName, rating: r.rating, body: r.body, tourTitle: r.tourTitle, createdAt: String(r.createdAt || '').slice(0, 10)
      }))
    }
  };
  if (!isPlace) return { ...base, expertise: h.expertise || null, credentials: h.credentials || null };

  const loc = h.approximateLocation; // already rounded to two decimals by publicHostFields()
  return {
    ...base,
    region: regionInfo(h.regionKey),
    regionText: h.region || null,
    lodgingType: h.lodgingType || null,
    capacity: h.capacityGuests || null,
    amenities: Array.isArray(h.amenities) ? h.amenities : [],
    houseRules: h.houseRules || null,
    area: loc ? { lat: loc.lat, lng: loc.lng } : null
  };
}

