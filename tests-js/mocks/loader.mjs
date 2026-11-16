// هوک resolve ماژول: ایمپورت‌های نامدار `sdk` و `sdk/db` را به ماک‌های محلی می‌نگارد
// تا همان کدی که روی tgcloud اجرا می‌شود، بدون تغییر در Node هم قابل تست باشد.
const MOCKS = {
  sdk: new URL('./sdk.js', import.meta.url).href,
  'sdk/db': new URL('./sdk-db.js', import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(MOCKS, specifier)) {
    return { url: MOCKS[specifier], shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
