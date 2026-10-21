# نشر ميزان على حساب Cloudflare

هذه النسخة تستخدم Cloudflare Workers لتشغيل API، وStatic Assets للواجهة، وD1 للحسابات. ملفات الواجهة لا تحتوي بيانات مالية فعلية. حماية البيانات تبدأ في Worker نفسه، مع Cloudflare Access لتسجيل الدخول.

تم إعداد `wrangler.jsonc` للحساب وقاعدة البيانات اللذين زوّد بهما المالك:

- Worker: `mizan-capital`
- D1 database: `mizan-capital-db`
- Binding: `DB`
- قاعدة البيانات الجديدة مستقلة عن قاعدة النسخة المستضافة سابقًا؛ هذا الإعداد لا ينقل أي سجلات قديمة تلقائيًا.

## 1. ربط المستودع

من Cloudflare > Workers & Pages > Create application، اختر استيراد مستودع GitHub كتطبيق **Worker**. وافق على وصول Cloudflare إلى مستودع `Mohamedabdelnabey88/Mizan-Capital`.

إعدادات البناء:

| الحقل | القيمة |
|---|---|
| Project/Worker name | `mizan-capital` |
| Production branch | `main` |
| Root directory | جذر المستودع؛ اتركه فارغًا |
| Build command | `pnpm build:cloudflare` |
| Deploy command | `pnpm deploy:cloudflare` |
| Non-production branches | عطّل نشرها على قاعدة الإنتاج |

يستخدم المشروع pnpm بالإصدار المحدد في `package.json`. إن ظهرت خانة Install command، استخدم `pnpm install --frozen-lockfile`. يجب أن تكون بيئة البناء Node.js 22.13 أو أحدث.

أمر النشر يطبّق ترقيات الجداول المرفقة ثم ينشر Worker. يحتاج Build API token داخل Cloudflare صلاحيات **Workers Scripts: Edit** و**D1: Edit** للحساب المقصود؛ لا تضع الرمز في الكود أو المحادثة. إذا رفض تطبيق الجداول بسبب صلاحية D1، عدّل رمز البناء من لوحة Cloudflare ثم أعد البناء.

لا تفعّل نشر الفروع أو Preview على قاعدة الإنتاج. `preview_urls` معطّل في الملف. استخدم قاعدة مستقلة لأي بيئة اختبار لاحقًا.

## 2. الدخول والجلسات

- تسجيل الدخول يتم عبر صفحة Next.js على Vercel ثم `POST /api/auth/login`، التي تمرّر الطلب إلى Worker.
- بيانات اعتماد المالك موجودة في `cloudflare/access.ts` داخل `USERS`. لا توجد إدارة مستخدمين من الواجهة حاليًا، ولا تُعدّل بيانات هذا القسم إلا في إجراء مستقل ومعتمد لتغيير كلمة المرور.
- عند نجاح الدخول يُنشأ رمز جلسة عشوائي. يُخزّن SHA-256 للرمز فقط في D1 داخل `auth_sessions`، ويُرسل الرمز في Cookie بخصائص `HttpOnly; Secure; SameSite=Lax` لمدة 7 أيام. تسجيل الخروج يحذف الجلسة من الخادم.
- حدود الدخول: 5 محاولات لكل عنوان عميل/بريد و30 محاولة لكل بريد خلال 15 دقيقة. خلف Vercel، حد البريد هو الأهم لأن Worker قد يرى عنوان الـ proxy.
- لا يعتمد الكود الحالي على Cloudflare Access أو متغيرات `ACCESS_TEAM_DOMAIN` و`ACCESS_AUD` و`OWNER_EMAIL` و`MEMBER_EMAILS`. لا تحذف متغيرات قديمة من لوحة التحكم ضمن مراجعة الكود؛ افحص اعتماد أي خدمة أخرى عليها أولًا.

## 3. قاعدة البيانات والترحيلات

الربط مع D1 يتم عبر binding باسم `DB` في `wrangler.jsonc`. تحتوي مجلد `drizzle` على ترحيلات الجداول والحماية. أضيفت قيود قاعدة البيانات في `0003_integrity_guards.sql` للتحقق من شكل أسطر القيود، ومبالغ الهللات الصحيحة غير السالبة، وتوازن المدين والدائن، وصحة JSON في السجلات، ومنع تعديل/حذف القيود وسجل التدقيق.

الترحيلات الجديدة تستخدم `IF NOT EXISTS` لتتحمل وجود المشغلات مسبقًا. لا تنفّذ ترحيلًا أو نشرًا على قاعدة الإنتاج أثناء المراجعة. أمر `pnpm deploy:cloudflare` يطبّق الترحيلات على D1 البعيدة ثم ينشر Worker؛ لا تستخدمه لاختبار فرع أو Preview. استخدم قاعدة D1 مستقلة للاختبارات.

للتحقق من وجود المشغلات على بيئة الاختبار:

```sql
SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name;
```

## 4. الفحوصات قبل الدمج

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:cloudflare
pnpm test:export
pnpm build:cloudflare
pnpm exec wrangler deploy --dry-run --config wrangler.jsonc
```

اختبارات Cloudflare تستخدم Miniflare وقاعدة D1 محلية معزولة. يجب أن تختبر حالات القيد غير المتوازن، والأسطر غير الصالحة، والمبالغ العشرية أو النصية، ومحاولات تعديل/حذف سجلات موجودة فعلًا، وحدود الدخول عند تدوير عناوين IP.

## قيود التشغيل

- نجاح الاختبارات لا يضمن بقاء كل حجم بيانات تحت حد CPU المجاني؛ راقب زمن المعالجة والصفوف المقروءة.
- تحميل البيانات الحالي يجلب دفتر مساحة المالك كاملًا؛ أضف pagination وتجميعات خادمية قبل تضخم السجلات.
- سجلات الموظفين بيانات رواتب وليست حسابات دخول. النظام الحالي مخصص لمساحة مالك واحدة.
- ملف JSON للتنزيل هو أرشيف فقط، وليس استعادة تلقائية. احتفظ بنسخ احتياطية آمنة واختبر الاستعادة في بيئة منفصلة.
- لا تضع كلمات مرور أو رموز وصول أو نسخ بيانات مالية في المستودع أو سجلات CI.

مراجع Cloudflare: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
