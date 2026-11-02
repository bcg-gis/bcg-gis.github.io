-- BCG GIS paneli: cədvəllər və giriş qaydaları (RLS).
-- Supabase → SQL Editor-də bir dəfə işə salın, sonra seed.sql-i işə salın.

create table profiles (
    id uuid primary key references auth.users on delete cascade,
    email text not null,
    role text not null default 'manager' check (role in ('admin', 'manager'))
);

create table contractors (
    name text primary key,
    workers integer not null default 0,
    machinery integer not null default 0,
    engineer text
);

create table projects (
    id text primary key,
    name text not null,
    status text not null check (status in ('bitmis', 'icrada', 'tehvil', 'layihe')),
    project_type text not null default 'lines' check (project_type in ('lines', 'points')),
    start_date date,
    end_date date,
    imported boolean not null default false,
    check (end_date is null or start_date is null or end_date >= start_date)
);

create table segments (
    id bigint generated always as identity primary key,
    project_id text not null references projects on delete cascade,
    code text not null,
    name text not null,
    point_a text not null,
    point_b text not null,
    start_date date,
    end_date date,
    contractor text references contractors(name) on update cascade on delete set null,
    total_km numeric not null default 0 check (total_km >= 0),
    done_km numeric not null default 0 check (done_km >= 0 and done_km <= total_km),
    status text not null check (status in ('bitmis', 'icrada', 'tehvil', 'layihe')),
    closures integer not null default 0 check (closures >= 0),
    manholes integer not null default 0 check (manholes >= 0),
    antennas integer not null default 0 check (antennas >= 0),
    coords jsonb not null,
    unique (project_id, code),
    check (end_date is null or start_date is null or end_date >= start_date)
);

create table materials (
    id bigint generated always as identity primary key,
    project text not null,
    material text not null,
    quantity text not null,
    invoice_no text not null default '',
    issued_qty text not null default '',
    used_qty text not null default '',
    state text not null,
    used_date date not null default current_date
);

create table notes (
    id bigint generated always as identity primary key,
    user_id uuid not null default auth.uid() references auth.users on delete cascade,
    author text not null default (auth.jwt() ->> 'email'),
    recipient text not null default 'all',
    duration_hours integer not null default 24,
    expires_at timestamptz,
    text text not null,
    created_at timestamptz not null default now()
);

-- Yeni istifadəçi üçün profil avtomatik yaradılır (rol: manager)
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into profiles (id, email) values (new.id, new.email);
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

alter table profiles enable row level security;
alter table contractors enable row level security;
alter table projects enable row level security;
alter table segments enable row level security;
alter table materials enable row level security;
alter table notes enable row level security;

-- Oxumaq yalnız daxil olmuş istifadəçilərə açıqdır
create policy "own profile" on profiles for select to authenticated using (true);
create policy "read contractors" on contractors for select to authenticated using (true);
create policy "read projects" on projects for select to authenticated using (true);
create policy "read segments" on segments for select to authenticated using (true);
create policy "read materials" on materials for select to authenticated using (true);
create policy "read notes" on notes for select to authenticated using (true);

-- Layihə əlavə etmək və silmək yalnız admin üçündür
create policy "admin writes projects" on projects for all to authenticated using (is_admin()) with check (is_admin());
create policy "admin writes segments" on segments for all to authenticated using (is_admin()) with check (is_admin());

-- Qeydi hər kəs yalnız öz adı və e-poçtu ilə yaza bilər; silə bilən isə müəllif və admindir
create policy "add own note" on notes for insert to authenticated with check (user_id = (select auth.uid()) and author = ((select auth.jwt()) ->> 'email'));
create policy "delete own note" on notes for delete to authenticated using (user_id = (select auth.uid()) or is_admin());

-- Linklə paylaşma: admin link yaradır, link sahibi girişsiz yalnız seçilmiş layihələrə baxır.
-- Anonim istifadəçinin cədvəllərə birbaşa çıxışı yoxdur, yalnız bu funksiya işləyir.
create table share_links (
    token uuid primary key default gen_random_uuid(),
    project_ids text[] not null,
    created_by uuid default auth.uid() references auth.users on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz
);

alter table share_links enable row level security;
create policy "admin manages share links" on share_links for all to authenticated using (is_admin()) with check (is_admin());

-- Podratçı mühəndislərinin telefonları və qeydlər linkə daxil deyil
create function get_shared_view(link uuid) returns jsonb
language sql stable security definer set search_path = public as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'status', p.status, 'start_date', p.start_date, 'end_date', p.end_date,
        'imported', false,
        'segments', (select coalesce(jsonb_agg(jsonb_build_object(
            'code', s.code, 'name', s.name, 'point_a', s.point_a, 'point_b', s.point_b,
            'start_date', s.start_date, 'end_date', s.end_date, 'contractor', s.contractor,
            'total_km', s.total_km, 'done_km', s.done_km, 'status', s.status,
            'closures', s.closures, 'manholes', s.manholes, 'coords', s.coords
        )), '[]'::jsonb) from segments s where s.project_id = p.id)
    ) order by p.name), '[]'::jsonb)
    from projects p
    join share_links l on p.id = any(l.project_ids)
    where l.token = link and (l.expires_at is null or l.expires_at > now());
$$;

grant execute on function get_shared_view(uuid) to anon, authenticated;

-- Linkin apardığı çizgilər və baxış yeri
alter table share_links add column drawings jsonb not null default '[]'::jsonb, add column view jsonb;

create function get_shared_extras(link uuid) returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object('drawings', drawings, 'view', view) from share_links
    where token = link and (expires_at is null or expires_at > now());
$$;

grant execute on function get_shared_extras(uuid) to anon, authenticated;

-- Saytdan redaktə: podratçı və materialları admin dəyişir
create policy "admin writes contractors" on contractors for all to authenticated using (is_admin()) with check (is_admin());
create policy "admin writes materials" on materials for all to authenticated using (is_admin()) with check (is_admin());

-- Xarici açar indeksləri və funksiya icazələri
create index segments_project_id_idx on segments(project_id);
create index segments_contractor_idx on segments(contractor);
create index notes_user_id_idx on notes(user_id);
create index share_links_created_by_idx on share_links(created_by);

revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;
