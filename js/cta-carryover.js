/* ═══════════════════════════════════════════════
   CTA Carryover — Wire marketing site CTAs to customer app /order/new
   Reads bag size, service type, and delivery speed from data attributes
   and redirects to customer app with query params.
   ═══════════════════════════════════════════════ */

// Customer app URL — read from env or default to sandbox
const APP_URL = (() => {
  // Check for various env-injected values
  if (typeof __NEXT_PUBLIC_APP_URL__ !== 'undefined' && __NEXT_PUBLIC_APP_URL__) return __NEXT_PUBLIC_APP_URL__;
  if (typeof __VITE_APP_URL__ !== 'undefined' && __VITE_APP_URL__) return __VITE_APP_URL__;

  // Check meta tag
  const meta = document.querySelector('meta[name="app-url"]');
  if (meta && meta.getAttribute('content')) return meta.getAttribute('content');

  // Default to sandbox
  const fallback = 'https://offload-customer-sandbox.onrender.com';
  console.warn('[Offload] APP_URL not set, defaulting to:', fallback);
  return fallback;
})();

/**
 * Build the customer app order URL with query params
 */
function buildOrderUrl(params) {
  const base = APP_URL.replace(/\/$/, '') + '/#/order/new';
  const qs = new URLSearchParams();

  if (params.service) qs.set('service', params.service);
  if (params.bag) qs.set('bag', params.bag);
  if (params.speed) {
    qs.set('service', 'same_day');
  }

  const qsStr = qs.toString();
  return qsStr ? `${base}?${qsStr}` : base;
}

/**
 * Navigate to customer app with parameters
 */
function goToApp(params) {
  window.location.href = buildOrderUrl(params);
}

/**
 * Initialize CTA carryover on all relevant elements
 */
export function initCTACarryover() {
  // Pricing bag select buttons
  document.querySelectorAll('.pricing-select[data-bag]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      goToApp({ bag: el.getAttribute('data-bag') });
    });
  });

  // Service select buttons
  document.querySelectorAll('.service-select[data-service]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      goToApp({ service: el.getAttribute('data-service') });
    });
  });

  // Speed select buttons (Same Day)
  document.querySelectorAll('.service-select[data-speed]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      goToApp({ speed: el.getAttribute('data-speed') });
    });
  });

  // Service cards (full card click)
  document.querySelectorAll('.pricing-card[data-service]').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't double-fire if they clicked the button inside
      if (e.target.closest('.service-select, .pricing-select')) return;
      goToApp({ service: el.getAttribute('data-service') });
    });
  });

  document.querySelectorAll('.pricing-card[data-speed]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.service-select, .pricing-select')) return;
      goToApp({ speed: el.getAttribute('data-speed') });
    });
  });

  // Generic "Get Started" / "Schedule" / "Book Now" / "Continue" CTAs
  // These are the main hero CTAs that should carry any active selection
  document.querySelectorAll('a[href="#hero-widget"]').forEach(el => {
    // Skip if already handled by a more specific handler above
    if (el.classList.contains('pricing-select') || el.classList.contains('service-select')) return;

    el.addEventListener('click', (e) => {
      e.preventDefault();
      goToApp({});
    });
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCTACarryover);
} else {
  initCTACarryover();
}
