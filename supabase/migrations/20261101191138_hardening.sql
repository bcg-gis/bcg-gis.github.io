-- Mövcud bazada işə salınan düzəlişlər:
--   1. Qeydlər və profillər: auth funksiyalarını (select ...) ilə çağır və müəllif e-poçtunu yoxla
--   2. segments.contractor → contractors(name) xarici açarı (on update cascade, on delete set null)
--   3. Xarici açar indeksləri (performans üçün)
--   4. Tarix və km yoxlamaları (check constraints)
--   5. SECURITY DEFINER funksiyalarının icazələrini məhdudlaşdır

-- 1. Qeydlər və profillər
alter policy "own profile" on profiles
    using (id = (select auth.uid()));

alter policy "add own note" on notes
    with check (user_id = (select auth.uid()) and author = ((select auth.jwt()) ->> 'email'));

alter policy "delete own note" on notes
    using (user_id = (select auth.uid()) or is_admin());

-- 2. Seqmentlərdəki podratçı FK əlavə et
alter table segments add constraint segments_contractor_fkey
    foreign key (contractor) references contractors(name)
    on update cascade on delete set null;

-- 3. Xarici açar indeksləri
create index if not exists segments_project_id_idx on segments(project_id);
create index if not exists segments_contractor_idx on segments(contractor);
create index if not exists notes_user_id_idx on notes(user_id);
create index if not exists share_links_created_by_idx on share_links(created_by);

-- 4. Tarix və uzunluq yoxlamaları
alter table projects add constraint projects_dates_check
    check (end_date is null or start_date is null or end_date >= start_date);

alter table segments add constraint segments_dates_check
    check (end_date is null or start_date is null or end_date >= start_date);

alter table segments add constraint segments_km_check
    check (total_km >= 0 and done_km >= 0 and done_km <= total_km);

alter table segments add constraint segments_assets_check
    check (closures >= 0 and manholes >= 0);

-- 5. SECURITY DEFINER funksiyalarının icazələrini məhdudlaşdır
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;
