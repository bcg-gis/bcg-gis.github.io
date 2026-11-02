-- Qeydlərə alıcı (recipient), qalma müddəti (duration_hours) və bitmə vaxtı (expires_at),
-- Materiallara tarix (used_date) sütunu əlavə edilir.

alter table notes
    add column if not exists recipient text not null default 'all',
    add column if not exists duration_hours integer not null default 24,
    add column if not exists expires_at timestamptz;

alter table materials
    add column if not exists used_date date not null default current_date;

alter policy "own profile" on profiles
    using (true);
