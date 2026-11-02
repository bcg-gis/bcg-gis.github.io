# BCG – Fiber Optik GIS Paneli

Baku Communications Group şəbəkəsi üçün tam ekran GIS idarəetmə paneli. Sayt GitHub Pages-də açılır, giriş və məlumat isə Supabase-dədir. Repoda heç bir layihə məlumatı yoxdur: marşrutlar yalnız daxil olmuş istifadəçiyə verilir.

## Supabase qurulumu

1. Supabase-də yeni layihə yaradın.
2. **SQL Editor**-də əvvəlcə `supabase/schema.sql`, sonra `supabase/seed.sql` faylını işə salın (`seed.sql` real məlumatdır və repoya düşmür).
   - Əgər baza əvvəldən qurulubsa, yalnız son düzəlişləri tətbiq etmək üçün `supabase/migrations/20261101191138_hardening.sql` faylını işə salın.
3. **Authentication → Sign In / Providers** bölməsində **Allow new users to sign up** seçimini söndürün. **Bu vacibdir:** açıq qalsa, hər kəs özünə hesab açıb məlumatı oxuya bilər.
4. **Authentication → Users → Add user** ilə istifadəçiləri yaradın.
5. Özünüzü admin edin (SQL Editor):

   ```sql
   update profiles set role = 'admin' where email = 'sizin@email.az';
   ```

6. **Project Settings → API**-dən Project URL və anon açarını `js/config.js` faylına yazın. `service_role` açarını heç vaxt yazmayın.
7. **Authentication → URL Configuration → Site URL** sahəsinə saytın GitHub Pages ünvanını yazın.

### Supabase CLI ilə idarəetmə (istəyə bağlı)

```bash
supabase login
supabase link --project-ref olbzelzdkqqmaapaugjs
# Əgər ilkin sxem bazada artıq varsa, onu qeydə alın:
supabase migration repair --status applied 20261101000000
# Yeni migration-ları bazaya göndərin:
supabase db push
```

Admin layihə, seqment, podratçı və materialları əlavə edə, redaktə edə, silə, KMZ/KML/GeoJSON import edə və paylaşma linki yarada bilir. Digər istifadəçilər baxır və qeyd yazır.

## Fayl strukturu

| Fayl | Təyinat |
| --- | --- |
| `index.html` | Səhifənin quruluşu |
| `css/styles.css` | Dizayn (tünd və açıq mövzular, mobil görünüş, çap) |
| `js/config.js` | Supabase ünvanı və anon açarı |
| `js/api.js` | Supabase ilə giriş və məlumat əlaqəsi |
| `js/i18n.js` | AZ / EN / RU mətnləri |
| `js/app.js` | Xəritə, panellər, admin redaktəsi və paylaşma məntiqi |
| `js/tools.js` | Ölçmə, çəkmə, yapışma (snap/ortho) və KMZ/PDF ixrac alətləri |
| `supabase/schema.sql` | Tam cədvəllər və giriş qaydaları (RLS) |
| `supabase/migrations/` | Versiyalı SQL miqrasiyaları (Supabase CLI üçün) |
| `supabase/config.toml` | Supabase CLI layihə tənzimləməsi |
| `supabase/seed.sql` | İlkin məlumat (yalnız sizin kompüterinizdə, repoya düşmür) |

## Kompüterdə işə salmaq

```bash
python -m http.server 4173
```

Sonra brauzerdə `http://localhost:4173` ünvanını açın.

## GitHub-a yükləmək

Bu qovluqda Git repozitoriyası artıq qurulub (`main` budağı). GitHub-da boş repozitoriya yaradın (məsələn `bcg-gis`), sonra:

```bash
git config user.name "HESAB_ADI"
git config user.email "HESAB_EMAIL"
git remote add origin https://github.com/HESAB_ADI/bcg-gis.git
git push -u origin main
```

`git config` əmrləri yalnız bu qovluğa aiddir, kompüterdəki digər layihələrə təsir etmir.

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
- Qeydlər və import edilmiş layihələr Supabase-də saxlanır, bütün daxil olmuş istifadəçilərə görünür.
- Xəritə üzərində çəkilən şəxsi çizgilər hər istifadəçi üçün ayrıca brauzer yaddaşında saxlanır.

## Xəritə mənbələri

Peyk görüntüsü və adlar Esri World Imagery, küçə xəritəsi OpenStreetMap, tünd xəritə CARTO xidmətlərindəndir. API açarı tələb olunmur. Mənbə qeydi xəritədən sahibin istəyi ilə götürülüb; bu xidmətlərin şərtləri isə onu tələb edir. Kommersiya və ya yüksək trafikli istifadədən əvvəl həmin xidmətlərin şərtlərini yoxlayın.
