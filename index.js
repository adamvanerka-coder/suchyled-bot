const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

// ── Konfigurace ───────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
console.log('SHEET_ID:', JSON.stringify(SHEET_ID));
const CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// ── Mapování Telegram ID → jméno operátora ────────────────
// Po prvním /start každého operátora přidej jeho ID sem:
const OPERATORI = {
  '8691290397': 'Adam Vaněrka',      // nahraď skutečnými ID
  '2047584695': 'Michal Matula',
};

const PROGRAMY = ['P1', 'P2', 'P3'];
const BEDNY = Array.from({length: 15}, (_, i) => String(i + 1));

// ── Stav konverzace ───────────────────────────────────────
const sessions = {};

// ── Telegram Bot ─────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });

// ── Google Sheets ─────────────────────────────────────────
async function zapisDoSheets(data) {
  const auth = new google.auth.GoogleAuth({
    credentials: CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const now = new Date();
  const datum = now.toLocaleDateString('cs-CZ');
  const cas   = now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:G',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[datum, cas, data.operator, data.program, data.bedna, data.kg, '']] },
  });
}

// ── Keyboard helpers ──────────────────────────────────────
function keyboard(items, cols = 3) {
  const rows = [];
  for (let i = 0; i < items.length; i += cols)
    rows.push(items.slice(i, i + cols).map(t => ({ text: t })));
  return { reply_markup: { keyboard: rows, one_time_keyboard: true, resize_keyboard: true } };
}

// ── /start ────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const id = String(msg.from.id);
  const jmeno = OPERATORI[id];
  if (jmeno) {
    bot.sendMessage(msg.chat.id, `Ahoj ${jmeno}! Napiš /led pro zadání výroby.`);
  } else {
    bot.sendMessage(msg.chat.id,
      `Tvoje Telegram ID je: ${id}\nPošli toto číslo správci bota aby tě přidal.`);
  }
});

// ── /led ─────────────────────────────────────────────────
bot.onText(/\/led/, (msg) => {
  const id = String(msg.from.id);
  if (!OPERATORI[id]) {
    bot.sendMessage(msg.chat.id, 'Nejsi registrovaný operátor. Kontaktuj správce.');
    return;
  }
  sessions[id] = { operator: OPERATORI[id], krok: 'program' };
  bot.sendMessage(msg.chat.id, 'Jaký program?', keyboard(PROGRAMY));
});

// ── Zpracování odpovědí ───────────────────────────────────
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  const id = String(msg.from.id);
  const session = sessions[id];
  if (!session) return;
  const text = msg.text?.trim();

  if (session.krok === 'program') {
    if (!PROGRAMY.includes(text)) {
      bot.sendMessage(msg.chat.id, 'Vyber program tlačítkem:', keyboard(PROGRAMY));
      return;
    }
    session.program = text;
    session.krok = 'bedna';
    bot.sendMessage(msg.chat.id, 'Číslo bedny?', keyboard(BEDNY, 5));

  } else if (session.krok === 'bedna') {
    if (!BEDNY.includes(text)) {
      bot.sendMessage(msg.chat.id, 'Vyber bednu tlačítkem:', keyboard(BEDNY, 5));
      return;
    }
    session.bedna = text;
    session.krok = 'kg';
    bot.sendMessage(msg.chat.id, 'Kolik kg?',
      { reply_markup: { remove_keyboard: true } });

  } else if (session.krok === 'kg') {
    const kg = parseFloat(text?.replace(',', '.'));
    if (isNaN(kg) || kg <= 0) {
      bot.sendMessage(msg.chat.id, 'Zadej číslo (např. 50 nebo 47.5):');
      return;
    }
    session.kg = kg;
    delete sessions[id];
    try {
      await zapisDoSheets(session);
      bot.sendMessage(msg.chat.id,
        `✅ Zapsáno!\n\nOperátor: ${session.operator}\nProgram: ${session.program}\nBedna: ${session.bedna}\nKg: ${session.kg}`);
    } catch (err) {
      console.error(err);
      bot.sendMessage(msg.chat.id, '❌ Chyba při zápisu. Zkus znovu nebo kontaktuj správce.');
    }
  }
});

console.log('Bot běží...');  
