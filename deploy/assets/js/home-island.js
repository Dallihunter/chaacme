// Home page: the hero video can be paused (WCAG 2.2.2) and stays paused for visitors who asked for less motion.
const video = document.querySelector('[data-hero-video]');

if (video) {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hm-hero__pause';
  const sync = () => {
    const playing = !video.paused;
    btn.textContent = playing ? 'توقف ویدیو' : 'پخش ویدیو';
    btn.setAttribute('aria-pressed', playing ? 'false' : 'true');
  };
  btn.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  if (reduced) { video.removeAttribute('autoplay'); video.pause(); }
  video.parentElement.append(btn);
  sync();
}
