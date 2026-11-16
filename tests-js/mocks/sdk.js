// ماژول `sdk` ساختگی — فقط برای تست محلی؛ tgcloud نسخه‌ی واقعی را تزریق می‌کند.
export const api = {};
export const db = {};
export const fetch = () => { throw new Error('mock fetch'); };
fetch.body = { json: (v) => ({ __fetchBody: true, value: v }) };

export class InputFile {
  constructor(bytes, filename, opts = {}) {
    this.bytes = bytes;
    this.filename = filename;
    this.type = opts.type;
  }
}
export class BotApiError extends Error {}
