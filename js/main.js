/* ═══════════════════════════════════════════════
   OFFLOAD USA — Main Entry Point (ES Module)
   Initialization, event listeners, window bindings
   ═══════════════════════════════════════════════ */

// ── Module Imports ──
import { updatePricePreview, initAdvancedControls, loadAddOns } from './pricing.js';
import { initAddressAutocomplete, initGeolocation, detectLocation } from './address.js';
import { _onServiceRadioChange, checkServiceability, showUnservedModal } from './stripe-pay.js';
import { initChatbot, sendChat } from './chatbot.js';
import {
  handleOrderClick,
  handleSignup,
  handleLogin,
  showLoginModal,
  showAppAvailability,
  resetOrder,
  saveFormState,
  restoreFormState,
  initPhoneFormatter,
  showFieldError,
} from './order-flow.js';

// ── Expose functions to window for HTML onclick handlers ──
window.handleOrderClick = handleOrderClick;
window.toggleFaq = toggleFaq;
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.showLoginModal = showLoginModal;
window.sendChat = sendChat;
window.closeMobile = closeMobile;
window.showAppComingSoon = showAppAvailability;
window.showAppAvailability = showAppAvailability;
window._onServiceRadioChange = _onServiceRadioChange;
window.resetOrder = resetOrder;

// ── Inject dynamic CSS (shake animation + pac-container styles) ──
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.4); }
  }
  .pac-container {
    background: #1a1a1a !important;
    border: 1px solid rgba(255,255,255,0.12) !important;
    border-radius: 10px !important;
    margin-top: 4px !important;
    font-family: 'Inter', sans-serif !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
    z-index: 10000 !important;
  }
  .pac-item {
    padding: 10px 14px !important;
    border-bottom: 1px solid rgba(255,255,255,0.06) !important;
    color: #e2e8f0 !important;
    cursor: pointer !important;
    font-size: 0.88rem !important;
  }
  .pac-item:hover, .pac-item-selected {
    background: rgba(91,75,196,0.15) !important;
  }
  .pac-item-query {
    color: #fff !important;
    font-weight: 600 !important;
  }
  .pac-icon { display: none !important; }
  .pac-item span { color: #94a3b8 !important; }
  .pac-item-query span { color: #fff !important; }
  .pac-logo::after { display: none !important; }
`;
document.head.appendChild(shakeStyle);

// ── Mobile Navigation ──
const hamburger = document.getElementById('hamburger');
const mobileNav = document.getElementById('mobile-nav');

hamburger?.addEventListener('click', () => {
  mobileNav.classList.toggle('active');
  // Animate hamburger
  const spans = hamburger.querySelectorAll('span');
  if (mobileNav.classList.contains('active')) {
    spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
    spans[1].style.opacity = '0';
    spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
  } else {
    spans[0].style.transform = '';
    spans[1].style.opacity = '';
    spans[2].style.transform = '';
  }
});

function closeMobile() {
  mobileNav?.classList.remove('active');
  const spans = hamburger?.querySelectorAll('span');
  if (spans) {
    spans[0].style.transform = '';
    spans[1].style.opacity = '';
    spans[2].style.transform = '';
  }
}

// ── Smooth scroll for anchor links ──
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 80; // header height
      const y = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  });
});


// ── FAQ Accordion ──
function toggleFaq(button) {
  const item = button.parentElement;
  const answer = item.querySelector('.faq-answer');
  const isActive = item.classList.contains('active');

  // Close all
  document.querySelectorAll('.faq-item').forEach(el => {
    el.classList.remove('active');
    el.querySelector('.faq-answer').style.maxHeight = null;
    el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
  });

  // Open clicked if not already open
  if (!isActive) {
    item.classList.add('active');
    answer.style.maxHeight = answer.scrollHeight + 'px';
    button.setAttribute('aria-expanded', 'true');
  }
}


// ── Scroll Animations ──
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.animate-in').forEach(el => observer.observe(el));


// ── Header scroll effect ──
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const header = document.getElementById('header');
  const current = window.pageYOffset;

  if (current > 100) {
    header.style.background = 'rgba(10, 22, 40, 0.98)';
    header.style.boxShadow = '0 2px 20px rgba(0,0,0,0.2)';
  } else {
    header.style.background = 'rgba(10, 22, 40, 0.95)';
    header.style.boxShadow = 'none';
  }

  lastScroll = current;
}, { passive: true });


// ── Listen to select changes ──
document.getElementById('bag-select')?.addEventListener('change', () => {
  updatePricePreview();
  saveFormState();
});
document.getElementById('speed-select')?.addEventListener('change', () => {
  updatePricePreview();
  saveFormState();
});
// Service type now also updates price
document.getElementById('service-select')?.addEventListener('change', () => {
  updatePricePreview();
  saveFormState();
});

// Save state on address/service changes
document.getElementById('address-input')?.addEventListener('input', saveFormState);

// Restore on load
restoreFormState();

// ── Pricing card → pre-select bag size ──
// Map pricing card "Select" buttons to bag sizes
document.querySelectorAll('.pricing-card').forEach(card => {
  const selectBtn = card.querySelector('.btn');
  if (!selectBtn) return;
  const nameEl = card.querySelector('.pricing-card__name');
  if (!nameEl) return;
  const cardName = nameEl.textContent.trim().toLowerCase();

  let bagKey = null;
  if (cardName.includes('small')) bagKey = 'small';
  else if (cardName.includes('medium')) bagKey = 'medium';
  else if (cardName.includes('large')) bagKey = 'large';
  else if (cardName.includes('xl')) bagKey = 'xl';

  if (!bagKey) return;

  selectBtn.addEventListener('click', (e) => {
    // Scroll to widget (href="#hero-widget" already handles this via anchor)
    // Set the bag select value
    const bagSelect = document.getElementById('bag-select');
    if (bagSelect) {
      bagSelect.value = bagKey;
      updatePricePreview();
      saveFormState();
    }
  });
});

// ── Initialize modules ──

// Phone number auto-formatter
initPhoneFormatter();

// Address autocomplete + geolocation
initAddressAutocomplete();
initGeolocation();

// Geo-location hero badge
detectLocation();

// Chatbot
initChatbot();

// Initialize advanced pricing controls and load add-ons
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initAdvancedControls(); loadAddOns(); });
} else {
  initAdvancedControls();
  loadAddOns();
}


// ── Service Area ZIP Check Form ──
(function initZipCheckForm() {
  const form = document.getElementById('zip-check-form');
  const input = document.getElementById('zip-check-input');
  const btn = document.getElementById('zip-check-btn');
  const result = document.getElementById('zip-check-result');
  if (!form || !input || !btn || !result) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const zip = input.value.trim();
    if (!zip || zip.length < 5) {
      result.innerHTML = '<span style="color:#fca5a5; font-size:0.9rem;">Please enter a valid ZIP code.</span>';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Checking...';
    result.innerHTML = '';

    try {
      const servable = await checkServiceability(zip);
      if (servable) {
        result.innerHTML =
          '<div style="display:inline-flex; align-items:center; gap:8px; background:rgba(34,197,94,0.12); border:1px solid rgba(34,197,94,0.3); border-radius:10px; padding:12px 20px;">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' +
            '<span style="color:#22c55e; font-weight:600; font-size:0.95rem;">We serve your area! <a href="#hero-widget" style="color:#5B4BC4; text-decoration:underline; font-weight:700;">Get your price now</a></span>' +
          '</div>';
      } else {
        showUnservedModal(zip);
        result.innerHTML =
          '<span style="color:#fca5a5; font-size:0.9rem;">We\'re not in your area yet. We\'ve opened a form so you can get notified when we arrive.</span>';
      }
    } catch (err) {
      result.innerHTML = '<span style="color:#fca5a5; font-size:0.9rem;">Something went wrong. Please try again.</span>';
    }

    btn.disabled = false;
    btn.textContent = 'Check';
  });
})();

// ── Console branding ──
console.log('%c🧺 Offload USA', 'font-size:24px; font-weight:bold; color:#5B4BC4;');
console.log('%cFresh clothes, zero hassle.', 'font-size:14px; color:#94a3b8;');
console.log('%chttps://offloadusa.com', 'font-size:12px; color:#64748b;');
