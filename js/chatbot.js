/* ═══════════════════════════════════════════════
   OFFLOAD USA — Chatbot Widget
   Pattern-matching chatbot with FAQ responses
   ═══════════════════════════════════════════════ */

// ── Chatbot ──
let chatbotInput = null;
let chatbotMessages = null;

// Chatbot response engine
const CHAT_RESPONSES = {
  pricing: {
    patterns: [/pric/i, /cost/i, /how much/i, /rate/i, /bag/i, /pound/i, /\$/i, /cheap/i, /expensive/i, /afford/i],
    response: "Our pricing is simple and transparent:\n\n**Wash & Fold (base prices):**\n• Small Bag (up to 10 lbs): $24.99\n• Medium Bag (up to 20 lbs): $44.99\n• Large Bag (up to 30 lbs): $59.99\n• XL Bag (up to 50 lbs): $89.99\n\n**Service adjustments:**\n• Dry Cleaning: +65% over base\n• Comforters & Bedding: +40% over base\n• Mix of Everything: +25% over base\n\nIf you go over the weight limit, it's just $2.50 per extra pound. Standard delivery (48h) is free. Would you like to place an order?"
  },
  delivery: {
    patterns: [/deliver/i, /speed/i, /fast/i, /how long/i, /turnaround/i, /when/i, /time/i, /quick/i, /express/i, /same.?day/i, /next.?day/i],
    response: "We offer 3 delivery speeds:\n\n• Standard: 48 hours (free delivery)\n• Next Day: 24 hours (+$5.99)\n• Same Day: 12 hours (+$12.99) — only when you schedule pickup for today\n\nWe track every order against these windows — if we miss your delivery time, reach out and we'll make it right."
  },
  tracking: {
    patterns: [/track/i, /where/i, /status/i, /driver/i, /gps/i, /location/i, /eta/i],
    response: "You can track your order in real-time! Once a driver is assigned, you'll see their live location on a GPS map. You get notifications at every step — driver en route, laundry picked up, washing started, out for delivery, and delivered. We also take GPS-stamped photos at pickup and delivery."
  },
  damage: {
    patterns: [/damage/i, /lost/i, /missing/i, /broken/i, /ruin/i, /stain/i, /claim/i, /protect/i, /guarantee/i, /insurance/i],
    response: "Every order is protected under our garment care policy. If something goes wrong, file a claim within 14 days and we'll work to resolve it quickly. We take photo proof at every handoff to protect both you and us."
  },
  services: {
    patterns: [/service/i, /offer/i, /dry clean/i, /comforter/i, /alteration/i, /bedding/i, /type/i],
    response: "We currently offer:\n\n• Wash & Fold — your everyday laundry\n• Dry Cleaning — professional garment care (1.65x base price)\n• Comforters & Bedding — bulky items handled with care (1.4x base price)\n• Mixed — mix of different items in one bag (1.25x base price)\n\nAlterations and dedicated commercial accounts are coming soon — email support@offloadusa.com if you have a bulk or commercial need today."
  },
  loyalty: {
    patterns: [/loyal/i, /reward/i, /point/i, /tier/i, /bronze/i, /silver/i, /gold/i, /platinum/i, /earn/i, /discount/i, /subscribe/i, /subscription/i, /plan/i, /member/i],
    response: "Our loyalty program rewards you on every order:\n\n• Bronze: Starting tier, 5% off first order\n• Silver (500 pts): 10% off + free delivery\n• Gold (2,000 pts): 15% off + priority matching\n• Platinum (5,000 pts): 20% off + priority support response\n\nYou earn points on every order — the more you use Offload, the more you save."
  },
  cancel: {
    patterns: [/cancel/i, /refund/i, /reschedule/i, /change/i, /modify/i],
    response: "You can cancel or reschedule for free any time before the driver starts heading to your location. After pickup begins, cancellation fees may apply. You can manage everything through the app, website, or chat with me right here!"
  },
  account: {
    patterns: [/account/i, /sign.?up/i, /register/i, /login/i, /need.?account/i],
    response: "No account needed to get a price or schedule a pickup! You'll only need to provide your email, phone, and payment info when you're ready to confirm. If you want to save your preferences, track past orders, or use loyalty points, scroll down to the Sign Up section to create a free account."
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
    response: "Want to grow with Offload?\n\nLaundromat Partners: Get a steady stream of orders with smart order queuing and automated payouts. Email partners@offloadusa.com\n\nDrivers: Earn $8.50+ per trip plus tips on your own schedule. Email drivers@offloadusa.com\n\nBoth get access to our full logistics platform."
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

export function sendChat() {
  const input = chatbotInput;
  if (!input) return;
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

export function initChatbot() {
  const chatbotTrigger = document.getElementById('chatbot-trigger');
  const chatbotPanel = document.getElementById('chatbot-panel');
  const chatbotClose = document.getElementById('chatbot-close');
  chatbotInput = document.getElementById('chatbot-input');
  chatbotMessages = document.getElementById('chatbot-messages');

  chatbotTrigger?.addEventListener('click', () => {
    chatbotPanel.classList.toggle('active');
    if (chatbotPanel.classList.contains('active')) {
      chatbotInput.focus();
    }
  });

  chatbotClose?.addEventListener('click', () => {
    chatbotPanel.classList.remove('active');
  });
}
