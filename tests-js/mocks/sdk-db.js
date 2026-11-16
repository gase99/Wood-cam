// پیاده‌سازی کوچک از DSL اسکیمای `sdk/db` فقط برای اجرای تست‌ها روی Node.
// در محیط واقعی tgcloud این فایل استفاده نمی‌شود (ماژول `sdk/db` پلتفرم جایگزین است).

function column(name, opts = {}) {
  const col = {
    name,
    mode: opts.mode,
    __column: true,
    primaryKey() { col.primaryKey = true; return col; },
    notNull() { col.notNull = true; return col; },
    unique() { col.unique = true; return col; },
    default(v) { col.defaultValue = v; return col; },
  };
  return col;
}

export const text = (name, opts) => column(name, opts);
export const integer = (name, opts) => column(name, opts);
export const json = (name, opts) => column(name ?? '', { ...opts, mode: 'json' });
export const table = (name, columns) => ({ ...columns, __table: { name, columns } });
export const eq = (left, right) => ({ left: left?.name ?? left, right, op: 'eq' });
export const sql = (strings, ...values) => ({ __sql: true, strings, values });
sql.raw = (s) => ({ __sql: true, raw: s });
export default { select() {}, insert() {}, update() {}, delete() {} };
