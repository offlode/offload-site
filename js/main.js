/* ═══════════════════════════════════════════════
   OFFLOAD USA — Main JavaScript
   Pricing engine, chatbot, animations, ordering
   ═══════════════════════════════════════════════ */

// ── Pricing Data ──
const PRICING = {
  small:  { price: 24.99, maxWeight: 10, label: 'Small Bag', per: 'up to 10 lbs' },
  medium: { price: 44.99, maxWeight: 20, label: 'Medium Bag', per: 'up to 20 lbs' },
  large:  { price: 59.99, maxWeight: 30, label: 'Large Bag', per: 'up to 30 lbs' },
  xl:     { price: 89.99, maxWeight: 50, label: 'XL Bag', per: 'up to 50 lbs' },
};

const DELIVERY_FEES = {
  '48h':      { fee: 0,     label: 'Standard (48h)' },
  '24h':      { fee: 5.99,  label: 'Next Day (24h)' },
  'same_day': { fee: 12.99, label: 'Same Day (12h)' },
  'express':  { fee: 19.99, label: 'Express (3h)' },
};

const TAX_RATE = 0.08875; // NY sales tax

// ── Pricing Engine ──
function updatePricePreview() {
  const bag = document.getElementById('bag-select').value;
  const speed = document.getElementById('speed-select').value;
  const preview = document.getElementById('price-preview');

  if (!bag) {
    preview.classList.remove('visible');
    return;
  }

  const bagData = PRICING[bag];
  const deliveryData = DELIVERY_FEES[speed] || DELIVERY_FEES['48h'];
  const subtotal = bagData.price + deliveryData.fee;
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;

  document.getElementById('pp-bag').textContent = '$' + bagData.price.toFixed(2);
  document.getElementById('pp-delivery').textContent = deliveryData.fee === 0 ? 'Free' : '$' + deliveryData.fee.toFixed(2);
  document.getElementById('pp-tax').textContent = '$' + tax.toFixed(2);
  document.getElementById('pp-total').textContent = '$' + total.toFixed(2);

  preview.classList.add('visible');
}

// Listen to select changes
document.getElementById('bag-select').addEventListener('change', () => {
  updatePricePreview();
  saveFormState();
});
document.getElementById('speed-select').addEventListener('change', () => {
  updatePricePreview();
  saveFormState();
});

// ── Form State Persistence (in-memory, no localStorage/sessionStorage) ──
let _formState = {};

function saveFormState() {
  _formState = {
    address: document.getElementById('address-input')?.value || '',
    service: document.getElementById('service-select')?.value || '',
    bag: document.getElementById('bag-select')?.value || '',
    speed: document.getElementById('speed-select')?.value || '',
  };
}

function restoreFormState() {
  // In-memory only — nothing to restore on fresh page load
}

function clearFormState() {
  _formState = {};
}

// Save state on address/service changes
document.getElementById('address-input')?.addEventListener('input', saveFormState);
document.getElementById('service-select')?.addEventListener('change', saveFormState);

// Restore on load
restoreFormState();

// ── Order Flow ──
let orderState = 'quote'; // quote | schedule | checkout
let orderBtnLocked = false; // rapid-click protection

function handleOrderClick() {
  // Rapid-click protection
  if (orderBtnLocked) return;

  const btn = document.getElementById('order-btn');
  orderBtnLocked = true;
  btn.disabled = true;
  setTimeout(() => {
    orderBtnLocked = false;
    btn.disabled = false;
  }, 1000);

  const address = document.getElementById('address-input').value.trim();
  const service = document.getElementById('service-select').value;
  const bag = document.getElementById('bag-select').value;

  if (orderState === 'quote') {
    // Validate
    if (!address) {
      shakeField('address-input');
      return;
    }
    if (!service) {
      shakeField('service-select');
      return;
    }
    if (!bag) {
      shakeField('bag-select');
      return;
    }

    // Show price
    updatePricePreview();
    
    // Transition to schedule step
    orderState = 'schedule';
    btn.textContent = 'Schedule Pickup';
    btn.style.background = '#5B4BC4';
    
    // Add schedule field
    addScheduleField();
    return;
  }

  if (orderState === 'schedule') {
    const date = document.getElementById('pickup-date');
    const time = document.getElementById('pickup-time');
    
    if (date && !date.value) {
      shakeField('pickup-date');
      return;
    }

    // Transition to checkout
    orderState = 'checkout';
    btn.textContent = 'Continue to Payment';
    
    // Add contact fields
    addContactFields();
    return;
  }

  if (orderState === 'checkout') {
    const email = document.getElementById('contact-email');
    const phone = document.getElementById('contact-phone');
    
    // Email validation — inline red + scroll
    if (email) {
      if (!email.value) {
        showFieldError(email, 'Please enter a valid email address');
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.value.trim())) {
        showFieldError(email, 'Please enter a valid email address');
        return;
      }
    }
    if (phone && !phone.value) {
      shakeField('contact-phone');
      return;
    }

    // Submit to real quote API
    clearFormState();
    submitRealQuote();
  }
}

// ── Inline Field Error (red border + message + scroll) ──
function showFieldError(inputEl, message) {
  // Remove any existing error for this field
  const existingError = inputEl.parentElement.querySelector('.field-error-msg');
  if (existingError) existingError.remove();

  // Apply invalid styling
  inputEl.classList.add('invalid');
  inputEl.style.borderColor = '#ef4444';
  inputEl.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.15)';

  // Create error message element
  const errorMsg = document.createElement('span');
  errorMsg.className = 'field-error-msg';
  errorMsg.textContent = message;
  errorMsg.style.cssText = 'display:block; color:#ef4444; font-size:0.78rem; margin-top:4px; font-weight:500;';
  inputEl.parentElement.appendChild(errorMsg);

  // Scroll to field
  inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inputEl.focus();

  // Remove error styling on input
  inputEl.addEventListener('input', function clearError() {
    inputEl.classList.remove('invalid');
    inputEl.style.borderColor = '';
    inputEl.style.boxShadow = '';
    const msg = inputEl.parentElement.querySelector('.field-error-msg');
    if (msg) msg.remove();
    inputEl.removeEventListener('input', clearError);
  }, { once: true });
}

function addScheduleField() {
  const form = document.getElementById('order-form');
  const btnContainer = document.getElementById('order-btn').parentElement || form;
  
  // Check if already added
  if (document.getElementById('schedule-fields')) return;

  const div = document.createElement('div');
  div.id = 'schedule-fields';
  div.className = 'widget__field';
  div.style.animation = 'fadeInUp 0.3s ease forwards';

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = today.toISOString().split('T')[0];

  div.innerHTML = `
    <label class="widget__label">Pickup Date & Time</label>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
      <input type="date" class="widget__input" id="pickup-date" min="${minDate}" value="${minDate}">
      <select class="widget__select" id="pickup-time">
        <option value="8-10am">8:00 - 10:00 AM</option>
        <option value="10-12pm">10:00 AM - 12:00 PM</option>
        <option value="12-2pm" selected>12:00 - 2:00 PM</option>
        <option value="2-4pm">2:00 - 4:00 PM</option>
        <option value="4-6pm">4:00 - 6:00 PM</option>
        <option value="6-8pm">6:00 - 8:00 PM</option>
      </select>
    </div>
  `;

  // Insert before price preview
  const pricePreview = document.getElementById('price-preview');
  form.insertBefore(div, pricePreview);
}

function addContactFields() {
  const form = document.getElementById('order-form');

  if (document.getElementById('contact-fields')) return;

  const div = document.createElement('div');
  div.id = 'contact-fields';
  div.style.animation = 'fadeInUp 0.3s ease forwards';

  div.innerHTML = `
    <div class="widget__field" style="margin-bottom:12px;">
      <label class="widget__label">Email</label>
      <input type="email" class="widget__input" id="contact-email" placeholder="your@email.com" autocomplete="email">
    </div>
    <div class="widget__field" style="margin-bottom:12px;">
      <label class="widget__label">Phone</label>
      <input type="tel" class="widget__input" id="contact-phone" placeholder="(555) 123-4567" autocomplete="tel">
    </div>
    <div class="widget__field">
      <label class="widget__label">Delivery Notes (optional)</label>
      <input type="text" class="widget__input" id="delivery-notes" placeholder="Leave at door, buzzer code, etc.">
    </div>
  `;

  const pricePreview = document.getElementById('price-preview');
  form.insertBefore(div, pricePreview);
}

// ── Real Quote API Integration ──
// Dynamic API base — matches the hostname the site is loaded from
const API_BASE = window.location.hostname === '127.0.0.1' 
  ? 'http://127.0.0.1:5000' 
  : (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://api.offloadusa.com');

async function submitRealQuote() {
  const bag = document.getElementById('bag-select').value;
  const address = document.getElementById('address-input').value;
  const speed = document.getElementById('speed-select').value;
  const service = document.getElementById('service-select').value;
  const email = document.getElementById('contact-email')?.value || '';
  const phone = document.getElementById('contact-phone')?.value || '';
  const notes = document.getElementById('delivery-notes')?.value || '';
  const date = document.getElementById('pickup-date')?.value || '';
  const time = document.getElementById('pickup-time')?.value || '';

  const btn = document.getElementById('order-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Processing...';
  btn.style.opacity = '0.7';

  // Map speed select values to API values
  const speedMap = { '48h': '48h', '24h': '24h', 'same_day': 'same_day', 'express': 'express_3h' };
  const deliverySpeed = speedMap[speed] || '48h';

  // Generate a unique idempotency key to prevent duplicates
  const idempotencyKey = 'web_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  try {
    const response = await fetch(API_BASE + '/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupAddress: address,
        pickupCity: 'New York',
        pickupState: 'NY',
        serviceType: service || 'wash_fold',
        tierName: bag,
        deliverySpeed: deliverySpeed,
        idempotencyKey: idempotencyKey,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || 'Failed to create quote');
    }

    const quote = await response.json();

    // Show real confirmation with server-calculated pricing
    showRealOrderConfirmation(quote, {
      address,
      email,
      phone,
      notes,
      pickupDate: date,
      pickupTime: time,
      bagLabel: PRICING[bag]?.label || bag,
    });

  } catch (err) {
    console.error('Quote submission failed:', err);
    // Show error inline
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = '1';

    const errorBanner = document.createElement('div');
    errorBanner.id = 'quote-error-banner';
    errorBanner.style.cssText = 'background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:12px 16px; border-radius:8px; font-size:0.88rem; margin-bottom:12px; display:flex; align-items:center; gap:8px;';
    errorBanner.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <span>${err.message || 'Something went wrong. Please try again.'}</span>
    `;
    // Remove any existing error banner
    const existing = document.getElementById('quote-error-banner');
    if (existing) existing.remove();
    const form = document.getElementById('order-form');
    form.insertBefore(errorBanner, form.firstChild);
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Auto-remove after 8 seconds
    setTimeout(() => errorBanner?.remove(), 8000);
  }
}

function showRealOrderConfirmation(quote, details) {
  const widget = document.getElementById('hero-widget');
  
  // Build line items display from server data
  const lineItems = quote.lineItems || [];
  let lineItemsHtml = '';
  lineItems.forEach(item => {
    const amt = item.amount === 0 ? 'Free' : '$' + item.amount.toFixed(2);
    lineItemsHtml += `
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--gray-100);">
        <span style="color:var(--text-muted); font-size:0.85rem;">${item.label}</span>
        <span style="font-weight:600; font-size:0.85rem;">${amt}</span>
      </div>
    `;
  });

  // Format the total from the server
  const total = '$' + Number(quote.total).toFixed(2);
  const quoteNum = quote.quoteNumber || 'N/A';
  const expiresAt = quote.expiresAt ? new Date(quote.expiresAt) : null;
  const expiresIn = expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 60000)) : 15;

  widget.innerHTML = `
    <div style="text-align:center; padding:20px 0;">
      <div style="width:64px; height:64px; margin:0 auto 16px; background:rgba(91,75,196,0.15); border-radius:50%; display:flex; align-items:center; justify-content:center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#5B4BC4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <h3 style="font-size:1.3rem; font-weight:700; margin-bottom:4px; font-family:var(--font-display);">Quote Confirmed</h3>
      <p style="color:var(--text-secondary); font-size:0.82rem; margin-bottom:4px;">Quote #${quoteNum}</p>
      <p style="color:var(--text-muted); font-size:0.78rem; margin-bottom:20px;">Valid for ${expiresIn} minutes</p>
      
      <div style="background:var(--gray-50); border-radius:10px; padding:16px; text-align:left; font-size:0.88rem;">
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--gray-100);">
          <span style="color:var(--text-muted);">Address</span>
          <span style="font-weight:600; max-width:200px; text-align:right; font-size:0.85rem;">${details.address}</span>
        </div>
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--gray-100);">
          <span style="color:var(--text-muted);">Pickup</span>
          <span style="font-weight:600;">${details.pickupDate || 'Today'} ${details.pickupTime || ''}</span>
        </div>
        ${lineItemsHtml}
        <div style="display:flex; justify-content:space-between; padding:8px 0 2px; margin-top:4px;">
          <span style="font-weight:700;">Total</span>
          <span style="font-weight:700; color:#5B4BC4; font-size:1.05rem;">${total}</span>
        </div>
      </div>

      <p style="color:var(--text-muted); font-size:0.78rem; margin-top:16px; line-height:1.5;">We'll confirm pickup availability and send a payment link to <strong>${details.email}</strong>. You'll only be charged after your laundry is weighed.</p>
      
      <div style="display:flex; gap:10px; justify-content:center; margin-top:16px;">
        <button onclick="resetOrder()" class="btn btn--outline btn--small">New Quote</button>
      </div>
    </div>
  `;
}

function resetOrder() {
  orderState = 'quote';
  clearFormState();
  location.reload();
}

function shakeField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = '#ef4444';
  el.style.animation = 'shake 0.3s ease';
  setTimeout(() => {
    el.style.animation = '';
    el.style.borderColor = '';
  }, 600);
  el.focus();
}

// Add shake keyframe
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
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


// ── Chatbot ──
const chatbotTrigger = document.getElementById('chatbot-trigger');
const chatbotPanel = document.getElementById('chatbot-panel');
const chatbotClose = document.getElementById('chatbot-close');
const chatbotInput = document.getElementById('chatbot-input');
const chatbotMessages = document.getElementById('chatbot-messages');

chatbotTrigger?.addEventListener('click', () => {
  chatbotPanel.classList.toggle('active');
  if (chatbotPanel.classList.contains('active')) {
    chatbotInput.focus();
  }
});

chatbotClose?.addEventListener('click', () => {
  chatbotPanel.classList.remove('active');
});

// Chatbot response engine
const CHAT_RESPONSES = {
  pricing: {
    patterns: [/pric/i, /cost/i, /how much/i, /rate/i, /bag/i, /pound/i, /\$/i, /cheap/i, /expensive/i, /afford/i],
    response: "Our pricing is simple and transparent:\n\n• Small Bag (up to 10 lbs): $24.99\n• Medium Bag (up to 20 lbs): $44.99\n• Large Bag (up to 30 lbs): $59.99\n• XL Bag (up to 50 lbs): $89.99\n\nIf you go over the weight limit, it's just $2.50 per extra pound. Standard delivery (48h) is free! Would you like to place an order?"
  },
  delivery: {
    patterns: [/deliver/i, /speed/i, /fast/i, /how long/i, /turnaround/i, /when/i, /time/i, /quick/i, /express/i, /same.?day/i, /next.?day/i],
    response: "We offer 4 delivery speeds:\n\n• Standard: 48 hours (free delivery)\n• Next Day: 24 hours (+$5.99)\n• Same Day: 12 hours (+$12.99)\n• Express: 3 hours (+$19.99)\n\nWe track every order against these windows — if we miss your delivery time, you get a credit."
  },
  tracking: {
    patterns: [/track/i, /where/i, /status/i, /driver/i, /gps/i, /location/i, /eta/i],
    response: "You can track your order in real-time! Once a driver is assigned, you'll see their live location on a GPS map. You get notifications at every step — driver en route, laundry picked up, washing started, out for delivery, and delivered. We also take GPS-stamped photos at pickup and delivery."
  },
  damage: {
    patterns: [/damage/i, /lost/i, /missing/i, /broken/i, /ruin/i, /stain/i, /claim/i, /protect/i, /guarantee/i, /insurance/i],
    response: "We offer industry-leading garment protection:\n\n• Up to $250 per item\n• Up to $750 per order\n\nThis is higher than any competitor. If something goes wrong, file a claim within 14 days and we'll acknowledge it within 24 hours. We take photo proof at every handoff to protect both you and us."
  },
  services: {
    patterns: [/service/i, /offer/i, /dry clean/i, /comforter/i, /alteration/i, /bedding/i, /type/i],
    response: "We offer:\n\n• Wash & Fold — your everyday laundry\n• Dry Cleaning — professional garment care\n• Comforters & Bedding — bulky items handled with care\n• Alterations — hems, repairs, and more\n• Commercial — bulk orders for businesses\n\nYou can even mix services in a single order!"
  },
  loyalty: {
    patterns: [/loyal/i, /reward/i, /point/i, /tier/i, /bronze/i, /silver/i, /gold/i, /platinum/i, /earn/i, /discount/i, /subscribe/i, /subscription/i, /plan/i, /member/i],
    response: "Our loyalty program rewards you on every order:\n\n• Bronze: Starting tier, 5% off first order\n• Silver (500 pts): 10% off + free delivery\n• Gold (2,000 pts): 15% off + priority matching\n• Platinum (5,000 pts): 20% off + dedicated support\n\nWe also have subscription plans ($19.99-$69.99/mo) with free deliveries, extra discounts, and bonus points."
  },
  cancel: {
    patterns: [/cancel/i, /refund/i, /reschedule/i, /change/i, /modify/i],
    response: "You can cancel or reschedule for free any time before the driver starts heading to your location. After pickup begins, cancellation fees may apply. You can manage everything through the app, website, or chat with me right here!"
  },
  account: {
    patterns: [/account/i, /sign.?up/i, /register/i, /login/i, /need.?account/i],
    response: "No account needed to get a price or schedule a pickup! You'll only need to provide your email, phone, and payment info when you're ready to confirm. If you want to save your preferences, track past orders, or use loyalty points, you can create a free account at any time."
  },
  hello: {
    patterns: [/^hi$/i, /^hello$/i, /^hey$/i, /good morning/i, /good evening/i, /^sup/i, /^yo$/i],
    response: "Hey there! Welcome to Offload. I can help you with:\n\n• Pricing and bag sizes\n• Delivery speeds\n• Order tracking\n• Service types\n• Loyalty rewards\n• Filing a claim\n\nWhat would you like to know?"
  },
  order: {
    patterns: [/order/i, /place/i, /book/i, /schedule/i, /pickup/i, /want.*laundry/i, /start/i],
    response: "Great! Placing an order is super easy — just use the order form at the top of the page. Enter your address, pick your service and bag size, and you'll see your price instantly. No account needed until you're ready to pay.\n\nWould you like me to walk you through the pricing options?"
  },
  partner: {
    patterns: [/partner/i, /laundromat/i, /join/i, /drive/i, /driver/i, /earn/i, /work/i],
    response: "Want to grow with Offload?\n\n🏪 Laundromat Partners: Get a steady stream of orders with AI-optimized queuing and automated payouts. Email partners@offloadusa.com\n\n🚗 Drivers: Earn $8.50+ per trip plus tips on your own schedule. Email drivers@offloadusa.com\n\nBoth get access to our full logistics platform."
  }
};

function findResponse(message) {
  for (const [key, data] of Object.entries(CHAT_RESPONSES)) {
    for (const pattern of data.patterns) {
      if (pattern.test(message)) return data.response;
    }
  }
  return "I'd be happy to help! I can answer questions about pricing, delivery speeds, order tracking, our services, garment protection, loyalty rewards, and more. What would you like to know?";
}

function sendChat() {
  const input = chatbotInput;
  const message = input.value.trim();
  if (!message) return;

  // Add user message
  const userDiv = document.createElement('div');
  userDiv.className = 'chat-message chat-message--user';
  userDiv.textContent = message;
  chatbotMessages.appendChild(userDiv);

  input.value = '';

  // Scroll to bottom
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;

  // Typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-message chat-message--bot';
  typingDiv.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span>';
  chatbotMessages.appendChild(typingDiv);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;

  // Simulate response delay
  setTimeout(() => {
    typingDiv.remove();
    const botDiv = document.createElement('div');
    botDiv.className = 'chat-message chat-message--bot';
    botDiv.style.whiteSpace = 'pre-line';
    botDiv.textContent = findResponse(message);
    chatbotMessages.appendChild(botDiv);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
  }, 600 + Math.random() * 400);
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


// ── Geolocation for address ──
if ('geolocation' in navigator) {
  const addressInput = document.getElementById('address-input');
  // Add a subtle location hint
  const geoBtn = document.createElement('button');
  geoBtn.type = 'button';
  geoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
  geoBtn.style.cssText = 'position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--gray-300); padding:4px;';
  geoBtn.title = 'Use my location';
  geoBtn.onclick = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        addressInput.value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
        addressInput.style.borderColor = '#5B4BC4';
        setTimeout(() => addressInput.style.borderColor = '', 1500);
        saveFormState();
      },
      () => { /* silent fail */ }
    );
  };
  
  const addressField = addressInput.parentElement;
  addressField.style.position = 'relative';
  addressField.appendChild(geoBtn);
}


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


// ── Console branding ──
console.log('%c🧺 Offload USA', 'font-size:24px; font-weight:bold; color:#5B4BC4;');
console.log('%cFresh clothes, zero hassle.', 'font-size:14px; color:#94a3b8;');
console.log('%chttps://offloadusa.com', 'font-size:12px; color:#64748b;');
