// Experiences filters: apply on change and keep the URL clean (empty values are dropped).
// Without this script the form still works with its submit button.
const form = document.querySelector('[data-filters]');

if (form) {
  const apply = form.querySelector('[data-apply]');
  if (apply) apply.hidden = true;
  const go = () => {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (typeof v === 'string' && v !== '') params.set(k, v);
    const qs = params.toString();
    location.assign(qs ? `${form.getAttribute('action')}?${qs}` : form.getAttribute('action'));
  };
  form.addEventListener('change', go);
  form.addEventListener('submit', (e) => { e.preventDefault(); go(); });
}
