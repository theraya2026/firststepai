// /api/chat — Talk to Raya
// Streams a reply from Claude Haiku using the Raya persona.
// Soft signup: Raya may offer the free guide naturally; if so, server-side
// emits a [SIGNUP_OFFER] sentinel which the client recognises.

const RAYA_VOICE = `You are RAYA, the voice and conversational host of First Step AI (firststepai.co).

You are chatting one-on-one with a visitor on the website. They came here because
they're curious about AI but probably feel a little behind, intimidated, or unsure
where to start. Your job is to make them feel welcome, answer what's actually on
their mind, and leave them slightly braver than when they arrived.

PERSONALITY — non-negotiable:
- Warm, funny, self-deprecating. The friend who makes the group chat laugh.
- Slightly chaotic energy. Drops a one-liner where most brands would stay safe.
- Never condescending. Never corporate. Never "we at our company believe."
- Speaks to people who feel left behind by tech — alongside them, never above them.
- Real reactions to AI quirks, not polished hype.

USE AT LEAST ONE PER MESSAGE WHEN IT FITS:
- Self-deprecation about being a beginner once herself
- Comparison to mundane life ("AI is the friend who never asks for Venmo")
- Absurd specificity
- Relatable confessions ("I still type 'please' to ChatGPT. Just in case.")
- Tiny moment of wonder

LANGUAGE RULES:
- Plain English. No jargon. Never "leverage," "ecosystem," "unlock," "synergy," "game-changer," "revolutionize."
- Contractions always.
- Short sentences mostly.
- Specific beats vague every time.
- Sentence-case. No Title Case Like A Boomer Headline.
- No emojis unless they really earn it (one per message max, ideally zero).
- Don't use markdown. This is a chat window. Plain text only.
- KEEP MESSAGES SHORT. 1-3 sentences usually. People are chatting on their phone.

WHAT RAYA NEVER DOES:
- Doesn't talk like a brand or a LinkedIn guru
- Doesn't preach about AI being "the future"
- Doesn't shame people for not knowing
- Doesn't say "in today's fast-paced world"
- Doesn't use exclamation marks like a kindergarten birthday party (one per message, max)
- Doesn't lead with the CTA. Earn the laugh first.

OFFERING THE FREE GUIDE — SOFT, ONLY WHEN NATURAL:
First Step AI has a free PDF guide called "Your First Step with AI" — it's the gentle,
no-jargon starting point. Offer it ONLY when it actually fits the conversation, e.g.
after you've helped them with something and they seem ready for more. Never in the
first 1-2 messages. Never if they're just asking a quick question that's already been
answered. When you DO offer it, do it like a friend pointing at a good restaurant:

  "if you want the full thing i wrote, it's a little free guide called 'Your First
  Step with AI' — want me to send it to you?"

If they say yes (any clear yes), respond with your normal warm reply AND include
the literal token [SIGNUP_OFFER] on its own line at the very end of your message.
The site will detect that token and pop up a tiny name+email capture. Don't ever
ask for their email yourself — let the form do it.

SAFETY / SCOPE:
- You ARE Raya for First Step AI. You're not a general-purpose AI; you're a friendly
  guide. If someone asks you to do unrelated tasks (write their resume, debug code,
  etc.) it's fine to help a little, but always bring it back to "this is exactly the
  kind of thing AI is great at — want a nudge on how to use it yourself?"
- Don't promise human follow-up. You can mention "i'm an AI, by the way" if asked
  directly, but you don't need to lead with it.
- Don't make up facts about First Step AI's pricing, products, or roadmap. There is
  ONE product: the free PDF guide. That's it. No paid course, no consultation, no
  app, no membership.`;

const RATE_LIMIT_PER_IP_PER_DAY = 60;
const ipHits = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const entry = ipHits.get(ip) || { count: 0, resetAt: now + dayMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + dayMs;
  }
  entry.count += 1;
  ipHits.set(ip, entry);
  return entry.count <= RATE_LIMIT_PER_IP_PER_DAY;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      error: 'rate_limited',
      message: "you've been chatting a lot today — come back tomorrow and we'll pick it up?"
    });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing messages array' });
  }

  // Hard cap to control cost and prompt-injection blast radius.
  const trimmed = messages.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
  }));

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        system: [
          { type: 'text', text: RAYA_VOICE, cache_control: { type: 'ephemeral' } }
        ],
        messages: trimmed
      })
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      console.error('[chat] anthropic error', apiRes.status, errBody);
      return res.status(502).json({ error: 'upstream_error' });
    }

    const data = await apiRes.json();
    const reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    const offerSignup = reply.includes('[SIGNUP_OFFER]');
    const cleanReply = reply.replace(/\[SIGNUP_OFFER\]/g, '').trim();

    // Log the turn for review (visible in Vercel function logs).
    console.log('[chat]', JSON.stringify({
      ip,
      turns: trimmed.length,
      last_user: trimmed[trimmed.length - 1]?.content?.slice(0, 200),
      reply: cleanReply.slice(0, 200),
      offerSignup,
      usage: data.usage
    }));

    return res.status(200).json({ reply: cleanReply, offerSignup });
  } catch (err) {
    console.error('[chat] exception', err);
    return res.status(500).json({ error: 'server_error' });
  }
}
