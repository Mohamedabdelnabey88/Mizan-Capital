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

## 2. تفعيل الدخول الخاص

بعد نجاح أول نشر، تظهر واجهة الموقع، لكن API يرفض عرض أو تعديل البيانات حتى تكتمل إعدادات الدخول.

1. فعّل Cloudflare Zero Trust بالخطة المجانية إن لم تكن مفعلة.
2. من Worker `mizan-capital` افتح **Access**، ثم **Protect this Worker behind Access**.
3. اختر **All traffic** لتشمل الحماية الإنتاج، ثم أكمل إعداد سياسة السماح.
4. في Zero Trust > Access controls > Applications، افتح التطبيق الناتج وعدّل سياسة Allow لتسمح **ببريد المالك وبريدَي العضوين المحددين فقط**. اختر Emails، وليس Everyone أو نطاق بريد عام مثل gmail.com.
5. استخدم One-time PIN عبر البريد أو مزوّد هوية سبق إعداده في حسابك.
6. انسخ **Application Audience (AUD) Tag** من Additional settings للتطبيق، واعرف عنوان الفريق `https://اسم-الفريق.cloudflareaccess.com`.

إذا اختلفت واجهة Cloudflare، يمكن إنشاء تطبيق Self-hosted لنطاق Worker الكامل من Access > Applications، مع سياسة بريد المالك نفسها. لا تقتصر الحماية على مسار واحد.

## 3. متغيرات Worker

من Workers & Pages > mizan-capital > Settings > Variables and Secrets، أضف متغيرات **Runtime** التالية. قيم المثال لا تعمل؛ استخدم القيم الفعلية من حسابك:

| الاسم | القيمة |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `https://اسم-الفريق.cloudflareaccess.com` بدون شرطة مائلة أخيرة |
| `ACCESS_AUD` | AUD الخاص بتطبيق ميزان |
| `OWNER_EMAIL` | البريد الكامل الذي سيستخدمه المالك للدخول |
| `MEMBER_EMAILS` | بريد العضو الأول وبريد العضو الثاني مفصولان بفاصلة إنجليزية `,`؛ اتركه فارغًا إن لم تضف أعضاء |

هذه القيم ليست كلمات مرور. `keep_vars: true` يحافظ على القيم المضافة من لوحة التحكم عند نشر تغييرات الكود. لا تضف قائمة `vars` فارغة إلى الإعدادات.

## 4. التحقق قبل إدخال البيانات

- افتح رابط Worker في نافذة خاصة: يجب أن تظهر شاشة Cloudflare Access.
- ادخل بالبريد المسموح، ثم تأكد أن لوحة ميزان تعرض مساحة فارغة بلا رسالة إعداد الدخول.
- جرّب بريدًا آخر: يجب رفض الوصول.
- أضف أول مشروع وقيّد رأس المال، ثم حدّث الصفحة للتأكد من حفظ البيانات.
- حمل نسخة البيانات من صفحة الضبط دوريًا. ملف JSON الحالي للأرشفة فقط، وليس استعادة تلقائية.

## التشغيل المحلي والفحوصات

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:cloudflare
pnpm build:cloudflare
pnpm exec wrangler deploy --dry-run --config wrangler.jsonc
```

اختبارات المحاسبة وCloudflare تستخدم قواعد محلية معزولة وشهادات مصطنعة للاختبار؛ لا تتصل بقاعدة الإنتاج. لا يوجد تجاوز دخول في كود الإنتاج. لاختبار الواجهة فقط يمكن استخدام وضع الاستعراض، أما واجهة البيانات فتتطلب رمز Access صحيحًا حتى عند تشغيلها محليًا.

## قيود التشغيل

- لا يعني نجاح الاختبارات ضمان بقاء كل حجم بيانات تحت حد CPU المجاني. راقب زمن المعالجة والصفوف المقروءة بعد التشغيل.
- حفظ الجداول الطويلة يستخدم إدخالًا وتحديثًا جماعيًا داخل transaction واحدة؛ فشل التحقق أو تعارض الإصدار يرجع العملية كلها.
- تحميل البيانات الحالي يجلب كامل دفتر مساحة المالك. قبل تضخم السجلات يلزم نقل التجميعات للخادم وإضافة pagination بدل افتراض استهلاك ثابت.
- حسابات الموظفين الحالية سجلات رواتب، وليست حسابات دخول. مساحة ميزان تسمح للمالك وعضوين إضافيين بالدخول بالبريد المعتمد، مع صلاحيات مالية متساوية وسجل يوضح بريد منفذ كل عملية. لا توجد إدارة مستخدمين داخل الموقع؛ الإضافة والإزالة من إعدادات Access ومتغيرات Worker.

مراجع Cloudflare: [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)، [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)، [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## صفحة الدخول والفريق

صفحة `/login` تعرض هوية ميزان وتوجّه إلى `/auth/login` لإتمام التحقق باستخدام Cloudflare Access. يتم فحص الجلسة من `/api/session` قبل عرض لوحة العمل.

يمكن إبقاء حماية All traffic؛ عندئذ تظهر شاشة Cloudflare أولًا. لإظهار صفحة ميزان قبل التحقق، استخدم تطبيق Access واحدًا يحتوي مسارَي المضيف العام `/api/*` و`/auth/*` على نطاق Worker نفسه، وسياسة السماح بالإيميلات الثلاثة نفسها. لا تنشئ سياسة Bypass لمسارات API. استخدم AUD لهذا التطبيق. باقي الواجهة عامة ولا تحتوي بيانات مالية، ويتحقق Worker من JWT وقائمة البريد في كل طلب.

جميع الأعضاء يستخدمون نفس مساحة البيانات الحالية دون إنشاء دفاتر منفصلة. لإلغاء وصول عضو احذف بريده من MEMBER_EMAILS ومن سياسة Access؛ يتحقق Worker من القائمة مع كل طلب حتى لو ظلت جلسة Access قديمة سارية.
