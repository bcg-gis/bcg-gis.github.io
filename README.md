# BCG – Fiber Optik GIS Paneli

Baku Communications Group şəbəkəsi üçün tam ekran GIS idarəetmə paneli. Sayt GitHub Pages-də açılır, giriş və məlumat isə Supabase-dədir. Repoda heç bir layihə məlumatı yoxdur: marşrutlar yalnız daxil olmuş istifadəçiyə verilir.

## Supabase qurulumu

1. Supabase-də yeni layihə yaradın.
2. **SQL Editor**-də əvvəlcə `supabase/schema.sql`, sonra `supabase/seed.sql` faylını işə salın. `seed.sql` real məlumatdır və repoya düşmür.
3. **Authentication → Sign In / Providers** bölməsində **Allow new users to sign up** seçimini söndürün. **Bu vacibdir:** açıq qalsa, hər kəs özünə hesab açıb məlumatı oxuya bilər.
4. **Authentication → Users → Add user** ilə istifadəçiləri yaradın.
5. Özünüzü admin edin (SQL Editor):

   ```sql
   update profiles set role = 'admin' where email = 'sizin@email.az';
   ```

6. **Project Settings → API**-dən Project URL və anon açarını `js/config.js` faylına yazın. `service_role` açarını heç vaxt yazmayın.
7. **Authentication → URL Configuration → Site URL** sahəsinə saytın GitHub Pages ünvanını yazın.

Admin layihə import edə və silə bilir, digər istifadəçilər baxır və qeyd yazır.

## Fayl strukturu

| Fayl | Təyinat |
| --- | --- |
| `index.html` | Səhifənin quruluşu |
| `css/styles.css` | Dizayn (tünd və açıq mövzu, mobil görünüş, çap) |
| `js/config.js` | Supabase ünvanı və anon açarı |
| `js/api.js` | Supabase ilə giriş və məlumat əlaqəsi |
| `js/i18n.js` | AZ / EN / RU mətnləri |
| `js/app.js` | Xəritə və panellərin məntiqi |
| `supabase/schema.sql` | Cədvəllər və giriş qaydaları (RLS) |
| `supabase/seed.sql` | İlkin məlumat (yalnız sizin kompüterinizdə, repoya düşmür) |

## Kompüterdə işə salmaq

```bash
python -m http.server 4173
```

Sonra brauzerdə `http://localhost:4173` ünvanını açın.

## GitHub-a yükləmək

Əvvəlcə GitHub-da digər hesabla boş repozitoriya yaradın (məsələn `bcg-gis`), sonra bu qovluqda:

```bash
git init -b main
git config user.name "HESAB_ADI"
git config user.email "HESAB_EMAIL"
git add .
git commit -m "BCG GIS paneli"
git remote add origin https://github.com/HESAB_ADI/bcg-gis.git
git push -u origin main
```

`git config` əmrləri yalnız bu qovluğa aiddir, kompüterdəki digər layihələrə təsir etmir. Windows yadda saxlanmış köhnə hesabla push etməyə çalışsa, push zamanı digər hesabla daxil olun.

## GitHub Pages ilə yayımlamaq

1. Repozitoriyada **Settings → Pages** bölməsini açın.
2. **Source: Deploy from a branch**, **Branch: main**, qovluq **/(root)** seçin və **Save** basın.
3. Bir neçə dəqiqədən sonra sayt `https://HESAB_ADI.github.io/bcg-gis/` ünvanında açılır.

Pulsuz hesabda GitHub Pages yalnız **public** repozitoriyadan işləyir, yəni kod hamıya açıq olur. Bu problem deyil: məlumat kodda yox, Supabase-dədir.

## Domen qoşmaq (sonra)

1. Domeni alın və DNS panelində yönləndirin:
   - Kök domen (`example.az`) üçün dörd `A` qeydi: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Və ya alt domen (`gis.example.az`) üçün `CNAME` qeydi: `HESAB_ADI.github.io`
2. **Settings → Pages → Custom domain** sahəsinə domeni yazın və **Save** basın.
3. Sertifikat hazır olanda **Enforce HTTPS** seçin.

4. Supabase-də **Site URL** sahəsini yeni domenə dəyişin.

Saytda bütün yollar nisbidir, ona görə kodda heç nə dəyişmək lazım deyil.

## Təhlükəsizlik

- Giriş Supabase Auth ilə yoxlanır, məlumatı isə verilənlər bazasındakı RLS qaydaları qoruyur. Anon açarının repoda olması normaldır.
- Qoruma yalnız qeydiyyat söndürüləndə işləyir (yuxarıdakı 3-cü addım).
- `seed.sql` faylını və `service_role` açarını repoya qoymayın.
- Qeydlər və import edilmiş layihələr Supabase-də saxlanır, bütün istifadəçilərə görünür.

## Xəritə mənbələri

Peyk görüntüsü və adlar Esri World Imagery, küçə xəritəsi OpenStreetMap, tünd xəritə CARTO xidmətlərindəndir. API açarı tələb olunmur. Mənbə qeydlərini (attribution) silməyin. Kommersiya və ya yüksək trafikli istifadədən əvvəl həmin xidmətlərin şərtlərini yoxlayın.
