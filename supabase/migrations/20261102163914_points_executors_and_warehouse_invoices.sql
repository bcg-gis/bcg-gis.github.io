-- Nöqtə layihələri (project_type = 'points', antennas), BCG (Öz briqadamız) iş icraçısı və Anbar Qaiməsi sütunları

alter table public.projects
    add column if not exists project_type text not null default 'lines' check (project_type in ('lines', 'points'));

alter table public.segments
    add column if not exists antennas integer not null default 0 check (antennas >= 0);

alter table public.materials
    add column if not exists invoice_no text not null default '',
    add column if not exists issued_qty text not null default '',
    add column if not exists used_qty text not null default '';

insert into public.contractors (name, workers, machinery, engineer)
values ('BCG (Öz briqadamız)', 38, 10, 'BCG Daxili Briqada (+994 50 200 10 10)')
on conflict (name) do nothing;

create or replace function public.get_shared_view(link uuid) returns jsonb
language sql stable security definer set search_path = public as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'status', p.status, 'start_date', p.start_date, 'end_date', p.end_date,
        'project_type', p.project_type, 'imported', false,
        'segments', (select coalesce(jsonb_agg(jsonb_build_object(
            'code', s.code, 'name', s.name, 'point_a', s.point_a, 'point_b', s.point_b,
            'start_date', s.start_date, 'end_date', s.end_date, 'contractor', s.contractor,
            'total_km', s.total_km, 'done_km', s.done_km, 'status', s.status,
            'closures', s.closures, 'manholes', s.manholes, 'antennas', s.antennas, 'coords', s.coords
        )), '[]'::jsonb) from segments s where s.project_id = p.id)
    ) order by p.name), '[]'::jsonb)
    from projects p
    join share_links l on p.id = any(l.project_ids)
    where l.token = link and (l.expires_at is null or l.expires_at > now());
$$;
