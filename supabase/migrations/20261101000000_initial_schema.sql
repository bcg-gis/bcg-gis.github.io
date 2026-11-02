-- İlkin sxem: supabase/schema.sql-in əvvəlki vəziyyəti (mövcud bazalarda artıq işə salınıb).
-- Düzəlişlər növbəti migration faylındadır.

create table if not exists profiles (
    id uuid primary key references auth.users on delete cascade,
    email text not null,
    role text not null default 'manager' check (role in ('admin', 'manager'))
);

create table if not exists contractors (
    name text primary key,
    workers integer not null default 0,
    machinery integer not null default 0,
    engineer text
);

create table if not exists projects (
    id text primary key,
    name text not null,
    status text not null check (status in ('bitmis', 'icrada', 'tehvil', 'layihe')),
    start_date date,
    end_date date,
    imported boolean not null default false
);

create table if not exists segments (
    id bigint generated always as identity primary key,
    project_id text not null references projects on delete cascade,
    code text not null,
    name text not null,
    point_a text not null,
    point_b text not null,
    start_date date,
    end_date date,
    contractor text,
    total_km numeric not null default 0,
    done_km numeric not null default 0,
    status text not null check (status in ('bitmis', 'icrada', 'tehvil', 'layihe')),
    closures integer not null default 0,
    manholes integer not null default 0,
    coords jsonb not null,
    unique (project_id, code)
);

create table if not exists materials (
    id bigint generated always as identity primary key,
    project text not null,
    material text not null,
    quantity text not null,
    state text not null
);

create table if not exists notes (
    id bigint generated always as identity primary key,
    user_id uuid not null default auth.uid() references auth.users on delete cascade,
    author text not null default (auth.jwt() ->> 'email'),
    text text not null,
    created_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into profiles (id, email) values (new.id, new.email);
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

alter table profiles enable row level security;
alter table contractors enable row level security;
alter table projects enable row level security;
alter table segments enable row level security;
alter table materials enable row level security;
alter table notes enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles for select to authenticated using (id = auth.uid());

drop policy if exists "read contractors" on contractors;
create policy "read contractors" on contractors for select to authenticated using (true);

drop policy if exists "read projects" on projects;
create policy "read projects" on projects for select to authenticated using (true);

drop policy if exists "read segments" on segments;
create policy "read segments" on segments for select to authenticated using (true);

drop policy if exists "read materials" on materials;
create policy "read materials" on materials for select to authenticated using (true);

drop policy if exists "read notes" on notes;
create policy "read notes" on notes for select to authenticated using (true);

drop policy if exists "admin writes projects" on projects;
create policy "admin writes projects" on projects for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "admin writes segments" on segments;
create policy "admin writes segments" on segments for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "add own note" on notes;
create policy "add own note" on notes for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "delete own note" on notes;
create policy "delete own note" on notes for delete to authenticated using (user_id = auth.uid() or is_admin());

create table if not exists share_links (
    token uuid primary key default gen_random_uuid(),
    project_ids text[] not null,
    created_by uuid default auth.uid() references auth.users on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz,
    drawings jsonb not null default '[]'::jsonb,
    view jsonb
);

alter table share_links enable row level security;
drop policy if exists "admin manages share links" on share_links;
create policy "admin manages share links" on share_links for all to authenticated using (is_admin()) with check (is_admin());

create or replace function get_shared_view(link uuid) returns jsonb
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

create or replace function get_shared_extras(link uuid) returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object('drawings', drawings, 'view', view) from share_links
    where token = link and (expires_at is null or expires_at > now());
$$;

grant execute on function get_shared_extras(uuid) to anon, authenticated;

drop policy if exists "admin writes contractors" on contractors;
create policy "admin writes contractors" on contractors for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "admin writes materials" on materials;
create policy "admin writes materials" on materials for all to authenticated using (is_admin()) with check (is_admin());
