/* Worker gym-report — прослойка между сайтом и Telegram.
   Единственное, ради чего он существует: токен бота нельзя класть в публичный
   репозиторий, а Pages не умеет хранить секреты. Данные тренировок здесь не
   хранятся — только chat_id, чтобы знать, кому слать отчёт.

   Секреты (ставятся через `wrangler secret put`, в файлах их нет):
     TG_TOKEN — токен бота от @BotFather
   Привязки:
     CHATS — KV-неймспейс, ключи chat:k и chat:a
*/

const ALLOWED_ORIGIN = "https://justbelieve9.github.io";
const PEOPLE = { k: "Костя", a: "Маша" };
const RATE_LIMIT_PER_DAY = 40;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors() }
  });

function cors() {
  return {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return r.json();
}

/* Имя бота нужно для deep link. Берём через getMe и кешируем в KV на сутки,
   чтобы не дёргать Telegram на каждый переход. */
async function botUsername(env) {
  const cached = await env.CHATS.get("meta:username");
  if (cached) return cached;
  const me = await tg(env, "getMe", {});
  const name = me && me.ok && me.result && me.result.username;
  if (name) await env.CHATS.put("meta:username", name, { expirationTtl: 86400 });
  return name;
}

/* Грубый суточный лимит: URL Worker виден в клиентском JS, и это защита
   от случайного шума, а не аутентификация. */
async function rateOk(env) {
  const key = "rate:" + new Date().toISOString().slice(0, 10);
  const n = Number((await env.CHATS.get(key)) || 0) + 1;
  await env.CHATS.put(key, String(n), { expirationTtl: 172800 });
  return n <= RATE_LIMIT_PER_DAY;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    /* ── Живость. Секретов в ответе нет. ── */
    if (path === "/health") {
      return json({
        ok: true,
        tokenConfigured: Boolean(env.TG_TOKEN),
        chats: {
          k: Boolean(await env.CHATS.get("chat:k")),
          a: Boolean(await env.CHATS.get("chat:a"))
        }
      });
    }

    /* ── Разовая привязка вебхука. Токен берётся из секрета, наружу не отдаётся. ── */
    if (path === "/setup") {
      if (!env.TG_TOKEN) return json({ ok: false, error: "TG_TOKEN не задан" }, 500);
      const res = await tg(env, "setWebhook", {
        url: `${url.origin}/tg`,
        allowed_updates: ["message"]
      });
      return json({ ok: res.ok, description: res.description });
    }

    /* ── Deep link: открывает Telegram с уже подставленным /start <код> ── */
    if (path === "/link") {
      const p = url.searchParams.get("p");
      if (!PEOPLE[p]) return json({ ok: false, error: "неизвестный код" }, 400);
      const name = await botUsername(env);
      if (!name) return json({ ok: false, error: "бот недоступен" }, 502);
      return Response.redirect(`https://t.me/${name}?start=${p}`, 302);
    }

    /* ── Вебхук Telegram: ловим /start <код> и запоминаем chat_id ── */
    if (path === "/tg" && request.method === "POST") {
      const update = await request.json().catch(() => null);
      const msg = update && update.message;
      if (!msg || !msg.text) return json({ ok: true });

      const m = msg.text.trim().match(/^\/start(?:\s+(\w+))?/);
      if (m) {
        const code = m[1];
        if (PEOPLE[code]) {
          await env.CHATS.put("chat:" + code, String(msg.chat.id));
          await tg(env, "sendMessage", {
            chat_id: msg.chat.id,
            text: `Готово. Отчёты о тренировках ${PEOPLE[code]} будут приходить сюда.`
          });
        } else {
          await tg(env, "sendMessage", {
            chat_id: msg.chat.id,
            text: "Открой ссылку «Подключить телеграм» в справке на сайте — она подставит нужный код."
          });
        }
      }
      return json({ ok: true });
    }

    /* ── Отчёт с сайта ── */
    if (path === "/report" && request.method === "POST") {
      if (request.headers.get("origin") !== ALLOWED_ORIGIN) {
        return json({ ok: false, error: "чужой origin" }, 403);
      }
      if (!env.TG_TOKEN) return json({ ok: false, error: "TG_TOKEN не задан" }, 500);
      if (!(await rateOk(env))) return json({ ok: false, error: "слишком часто" }, 429);

      const body = await request.json().catch(() => null);
      if (!body || !PEOPLE[body.person] || typeof body.text !== "string") {
        return json({ ok: false, error: "плохой запрос" }, 400);
      }
      if (body.text.length > 3500) return json({ ok: false, error: "отчёт слишком длинный" }, 400);

      const chatId = await env.CHATS.get("chat:" + body.person);
      if (!chatId) return json({ ok: false, error: "телеграм не подключён" }, 409);

      const res = await tg(env, "sendMessage", {
        chat_id: chatId,
        text: body.text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      });
      return json({ ok: Boolean(res.ok), description: res.description }, res.ok ? 200 : 502);
    }

    return json({ ok: false, error: "нет такого маршрута" }, 404);
  }
};
